const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

// In-memory sets for microsecond lookups on every incoming HTTP request
const blockedIps = new Set();
const blockedMacs = new Set();

let isInitialized = false;

/**
 * Initialize in-memory cache of actively blocked IPs and MACs from database
 */
async function initBlockedCache() {
  try {
    const activeBlocks = await mainPrisma.blockedClient.findMany({
      where: { isBlocked: true },
      select: { type: true, identifier: true, ipAddress: true, macAddress: true }
    });

    blockedIps.clear();
    blockedMacs.clear();

    for (const b of activeBlocks) {
      const id = String(b.identifier || "").trim().toLowerCase();
      if (!id) continue;

      if (b.type === "IP") {
        blockedIps.add(id);
      } else if (b.type === "MAC") {
        blockedMacs.add(id);
      }

      // Also index explicit ipAddress or macAddress if present
      if (b.ipAddress) blockedIps.add(String(b.ipAddress).trim().toLowerCase());
      if (b.macAddress) blockedMacs.add(String(b.macAddress).trim().toLowerCase());
    }

    isInitialized = true;
    console.log(`🛡️ [SECURITY] Blocked clients cache loaded: ${blockedIps.size} IPs, ${blockedMacs.size} MACs`);
  } catch (error) {
    console.error("❌ Failed to initialize blocked clients cache:", error.message);
  }
}

// Initial cache load
initBlockedCache();

// Periodic sync every 60 seconds to ensure multi-instance / manual DB changes sync
setInterval(() => {
  initBlockedCache().catch(() => null);
}, 60 * 1000);

/**
 * Synchronous fast check to see if an IP or MAC is currently blocked.
 */
function isClientBlocked(ip, mac) {
  const cleanIp = ip ? String(ip).trim().toLowerCase() : "";
  const cleanMac = mac ? String(mac).trim().toLowerCase() : "";

  if (cleanIp && blockedIps.has(cleanIp)) {
    return { blocked: true, type: "IP", identifier: cleanIp };
  }

  if (cleanMac && blockedMacs.has(cleanMac)) {
    return { blocked: true, type: "MAC", identifier: cleanMac };
  }

  return { blocked: false };
}

/**
 * Block a client (IP or MAC address).
 * Updates or creates record in PostgreSQL and immediately updates in-memory Set.
 */
async function blockClient({ type, identifier, ip, mac, reason, notes, requestCount }) {
  if (!identifier) {
    throw new ApiError(400, "Identifier (IP or MAC address) is required");
  }

  const cleanIdentifier = String(identifier).trim().toLowerCase();
  const normalizedType = String(type || "IP").toUpperCase() === "MAC" ? "MAC" : "IP";
  const cleanIp = ip ? String(ip).trim().toLowerCase() : (normalizedType === "IP" ? cleanIdentifier : null);
  const cleanMac = mac ? String(mac).trim().toLowerCase() : (normalizedType === "MAC" ? cleanIdentifier : null);

  const record = await mainPrisma.blockedClient.upsert({
    where: { identifier: cleanIdentifier },
    update: {
      isBlocked: true,
      type: normalizedType,
      ipAddress: cleanIp,
      macAddress: cleanMac,
      reason: reason || "Exceeded rate limit",
      notes: notes || undefined,
      blockedAt: new Date(),
      unblockedAt: null,
      unblockedBy: null,
      requestCount: requestCount !== undefined ? Number(requestCount) : { increment: 1 },
    },
    create: {
      type: normalizedType,
      identifier: cleanIdentifier,
      ipAddress: cleanIp,
      macAddress: cleanMac,
      reason: reason || "Exceeded rate limit",
      notes: notes || null,
      isBlocked: true,
      requestCount: requestCount ? Number(requestCount) : 1,
      blockedAt: new Date(),
    },
  });

  // Immediately reflect in memory
  if (normalizedType === "IP") {
    blockedIps.add(cleanIdentifier);
  } else {
    blockedMacs.add(cleanIdentifier);
  }
  if (cleanIp) blockedIps.add(cleanIp);
  if (cleanMac) blockedMacs.add(cleanMac);

  console.warn(`🛑 [SECURITY - CLIENT BLOCKED] Type: ${normalizedType} | Identifier: ${cleanIdentifier} | Reason: ${reason || "Exceeded rate limit"}`);
  return record;
}

/**
 * Unblock / Allow a client.
 * Sets isBlocked = false and immediately removes from in-memory cache.
 */
async function unblockClient(id, unblockedBy) {
  const existing = await mainPrisma.blockedClient.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Blocked client record not found");
  }

  const updated = await mainPrisma.blockedClient.update({
    where: { id },
    data: {
      isBlocked: false,
      unblockedAt: new Date(),
      unblockedBy: unblockedBy || "Super Admin",
    },
  });

  const cleanId = String(updated.identifier || "").trim().toLowerCase();
  blockedIps.delete(cleanId);
  blockedMacs.delete(cleanId);

  if (updated.ipAddress) blockedIps.delete(String(updated.ipAddress).trim().toLowerCase());
  if (updated.macAddress) blockedMacs.delete(String(updated.macAddress).trim().toLowerCase());

  console.log(`✅ [SECURITY - CLIENT UNBLOCKED] Allowed: ${updated.identifier} (${updated.type}) by ${unblockedBy || "Super Admin"}`);
  return updated;
}

/**
 * Re-block a previously allowed client.
 */
async function reblockClient(id, blockedBy) {
  const existing = await mainPrisma.blockedClient.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Client record not found");
  }

  const updated = await mainPrisma.blockedClient.update({
    where: { id },
    data: {
      isBlocked: true,
      blockedAt: new Date(),
      unblockedAt: null,
      unblockedBy: null,
      notes: blockedBy ? `Re-blocked by ${blockedBy}` : existing.notes,
    },
  });

  const cleanId = String(updated.identifier || "").trim().toLowerCase();
  if (updated.type === "IP") {
    blockedIps.add(cleanId);
  } else {
    blockedMacs.add(cleanId);
  }
  if (updated.ipAddress) blockedIps.add(String(updated.ipAddress).trim().toLowerCase());
  if (updated.macAddress) blockedMacs.add(String(updated.macAddress).trim().toLowerCase());

  return updated;
}

/**
 * Delete a blocked client record completely.
 */
async function deleteBlockedClient(id) {
  const existing = await mainPrisma.blockedClient.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Blocked client record not found");
  }

  const cleanId = String(existing.identifier || "").trim().toLowerCase();
  blockedIps.delete(cleanId);
  blockedMacs.delete(cleanId);
  if (existing.ipAddress) blockedIps.delete(String(existing.ipAddress).trim().toLowerCase());
  if (existing.macAddress) blockedMacs.delete(String(existing.macAddress).trim().toLowerCase());

  await mainPrisma.blockedClient.delete({ where: { id } });
  return { success: true, deletedId: id };
}

/**
 * List blocked clients with pagination, search, and filtering.
 */
async function getBlockedClients({ search, type, status, page = 1, limit = 20 }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const where = {};

  if (type && type !== "ALL") {
    where.type = String(type).toUpperCase();
  }

  if (status === "BLOCKED") {
    where.isBlocked = true;
  } else if (status === "ALLOWED" || status === "UNBLOCKED") {
    where.isBlocked = false;
  }

  if (search && String(search).trim()) {
    const q = String(search).trim();
    where.OR = [
      { identifier: { contains: q, mode: "insensitive" } },
      { ipAddress: { contains: q, mode: "insensitive" } },
      { macAddress: { contains: q, mode: "insensitive" } },
      { reason: { contains: q, mode: "insensitive" } },
      { unblockedBy: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const [records, total, totalBlocked, blockedIpsCount, blockedMacsCount, totalAllowed] = await Promise.all([
    mainPrisma.blockedClient.findMany({
      where,
      orderBy: { blockedAt: "desc" },
      skip,
      take: limitNum,
    }),
    mainPrisma.blockedClient.count({ where }),
    mainPrisma.blockedClient.count({ where: { isBlocked: true } }),
    mainPrisma.blockedClient.count({ where: { isBlocked: true, type: "IP" } }),
    mainPrisma.blockedClient.count({ where: { isBlocked: true, type: "MAC" } }),
    mainPrisma.blockedClient.count({ where: { isBlocked: false } }),
  ]);

  return {
    data: records,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
    stats: {
      totalBlocked,
      blockedIps: blockedIpsCount,
      blockedMacs: blockedMacsCount,
      totalAllowed,
      totalAll: totalBlocked + totalAllowed,
    },
  };
}

module.exports = {
  initBlockedCache,
  isClientBlocked,
  blockClient,
  unblockClient,
  reblockClient,
  deleteBlockedClient,
  getBlockedClients,
};

