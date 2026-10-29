/**
 * IP and MAC-based Rate Limiter Middleware
 * 
 * Provides dual-layer attack protection:
 * 1. IP Rate Limiting: Blocks flood attacks from a specific IP.
 * 2. MAC / Device-based Rate Limiting: Identifies clients by MAC address (via ARP table lookup,
 *    network interfaces, or client device headers). Even if an attacker uses an IP-changer app
 *    or VPN rotation, their device/MAC remains the same and will be blocked across rotating IPs.
 */

const { rateLimit } = require("express-rate-limit");
const { exec } = require("child_process");
const os = require("os");

// In-memory ARP Cache: Maps IPv4 -> MAC address
const arpCache = new Map();
let lastArpRefresh = 0;
const ARP_CACHE_TTL = 30 * 1000; // 30 seconds

/**
 * Refresh ARP table asynchronously in the background.
 */
function refreshArpTable() {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "arp -a" : "arp -an || cat /proc/net/arp";

  exec(cmd, { timeout: 3000 }, (err, stdout) => {
    if (err || !stdout) return;

    try {
      lastArpRefresh = Date.now();
      const lines = stdout.split(/\r?\n/);

      for (const line of lines) {
        // Windows format:  192.168.1.1       14-a7-2b-97-9b-68     dynamic
        // Linux format:    ? (192.168.1.1) at 14:a7:2b:97:9b:68 [ether] on eth0
        const winMatch = line.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F-]{17})/);
        if (winMatch) {
          const ip = winMatch[1];
          const mac = winMatch[2].replace(/-/g, ":").toLowerCase();
          arpCache.set(ip, mac);
          continue;
        }

        const nixMatch = line.match(/\(?([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\)?\s+(?:at\s+)?([0-9a-fA-F:]{17})/);
        if (nixMatch) {
          const ip = nixMatch[1];
          const mac = nixMatch[2].toLowerCase();
          arpCache.set(ip, mac);
        }
      }
    } catch (_e) {
      // Non-fatal
    }
  });
}

// Initial background ARP table fetch
try {
  refreshArpTable();
} catch (_e) {}

/**
 * Resolves local server network interface MAC (for loopback / localhost requests)
 */
function getLocalInterfaceMac() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.family === "IPv4" && iface.mac && iface.mac !== "00:00:00:00:00:00") {
          return iface.mac.toLowerCase();
        }
      }
    }
  } catch (_e) {}
  return "00:00:00:00:00:01";
}

const LOCAL_SERVER_MAC = getLocalInterfaceMac();

/**
 * Extracts and normalizes client IP address from request.
 */
function getClientIp(req) {
  // Check standard proxy headers
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ips = (typeof forwarded === "string" ? forwarded : forwarded[0])
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ips.length > 0) return ips[0].replace(/^::ffff:/, "");
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) return String(realIp).trim().replace(/^::ffff:/, "");

  const remote = req.ip || req.socket?.remoteAddress || "127.0.0.1";
  return String(remote).replace(/^::ffff:/, "");
}

/**
 * Extracts or resolves client MAC address:
 * 1. Client device headers (x-mac-address, x-client-mac, x-device-mac, x-hardware-id)
 * 2. ARP table lookup for the client IP
 * 3. Localhost fallback
 */
function getClientMac(req) {
  // 1. Direct custom headers (sent by mobile apps, POS hardware, or tools)
  const headerMac =
    req.headers["x-mac-address"] ||
    req.headers["x-client-mac"] ||
    req.headers["x-device-mac"] ||
    req.headers["x-hardware-id"] ||
    req.headers["x-device-id"] ||
    req.headers["mac-address"];

  if (headerMac && typeof headerMac === "string") {
    const clean = headerMac.trim().toLowerCase().replace(/-/g, ":");
    if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(clean)) {
      return clean;
    }
    // If it's a device hardware UUID / fingerprint, prefix it so it is unique
    if (clean.length >= 8) {
      return `dev:${clean.slice(0, 32)}`;
    }
  }

  // 2. Resolve client IP
  const ip = getClientIp(req);

  // If local loopback
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") {
    return LOCAL_SERVER_MAC;
  }

  // 3. ARP cache lookup
  if (arpCache.has(ip)) {
    return arpCache.get(ip);
  }

  // If cache is stale or missing IP, trigger background refresh
  if (Date.now() - lastArpRefresh > ARP_CACHE_TTL) {
    refreshArpTable();
  }

  return null;
}

// Configuration from environment variables
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 minutes default
const MAX_IP_REQUESTS = Number(process.env.RATE_LIMIT_MAX_IP) || 400; // 400 requests per 15 min per IP
const MAX_MAC_REQUESTS = Number(process.env.RATE_LIMIT_MAX_MAC) || 400; // 400 requests per 15 min per MAC

/**
 * Standard skip helper for health checks and static uploads
 */
function shouldSkip(req) {
  const p = req.path || req.url || "";
  return p.startsWith("/uploads") || p === "/health" || p === "/api/health";
}

/**
 * IP-Based Rate Limiter
 */
const ipRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_IP_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkip,
  keyGenerator: (req) => `ip:${getClientIp(req)}`,
  handler: (req, res) => {
    const ip = getClientIp(req);
    const mac = getClientMac(req) || "unknown";
    console.warn(`⚠️ [RATE LIMIT - IP BLOCKED] IP: ${ip} | MAC: ${mac} | Path: ${req.originalUrl}`);
    res.status(429).json({
      success: false,
      message: "Too many requests from this IP address. Please try again later.",
      code: "IP_RATE_LIMIT_EXCEEDED",
      clientIp: ip,
      retryAfter: Math.ceil(WINDOW_MS / 1000),
    });
  },
});

/**
 * MAC / Device-Based Rate Limiter
 * Catches attackers rotating or changing IP addresses from the same machine or device.
 */
const macRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_MAC_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => shouldSkip(req) || !getClientMac(req),
  keyGenerator: (req) => `mac:${getClientMac(req)}`,
  handler: (req, res) => {
    const ip = getClientIp(req);
    const mac = getClientMac(req);
    console.warn(`🛑 [RATE LIMIT - MAC/DEVICE BLOCKED] MAC: ${mac} | Current IP: ${ip} | Path: ${req.originalUrl}`);
    res.status(429).json({
      success: false,
      message: "Too many requests from this device/MAC address. Rate limit exceeded even if IP address was changed. Please try again later.",
      code: "MAC_RATE_LIMIT_EXCEEDED",
      deviceMac: mac,
      retryAfter: Math.ceil(WINDOW_MS / 1000),
    });
  },
});

/**
 * Combined Dual Rate Limiting Middleware
 */
const rateLimiter = (req, res, next) => {
  ipRateLimiter(req, res, (err) => {
    if (err) return next(err);
    macRateLimiter(req, res, next);
  });
};

module.exports = {
  getClientIp,
  getClientMac,
  ipRateLimiter,
  macRateLimiter,
  rateLimiter,
};

