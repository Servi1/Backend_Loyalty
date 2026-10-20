const mainPrisma = require("./prisma");

const defaults = {
  marketEnabled: "true",
  maintenance_mode: "false",
  new_signups: "true",
  guest_checkout: "true",
  scheduled_orders: "false",
  auto_payout: "true",
  refund_enabled: "true",
  push_notifications: "true",
  email_marketing: "false",
  sms_live_enabled: "false",
  otp_bypass_enabled: "true",
  otp_bypass_code: "9473",
  disabledCategories: "",
  platform_vat: "15.0",
};

let cache = { ...defaults };
let lastFetched = 0;
const CACHE_TTL_MS = 20000; // 20 seconds TTL

/**
 * Refresh the in-memory cache from the database.
 */
async function refreshCache() {
  try {
    const settings = await mainPrisma.systemSetting.findMany();
    const newCache = { ...defaults };
    for (const s of settings) {
      newCache[s.key] = s.value;
    }
    cache = newCache;
    lastFetched = Date.now();
    return cache;
  } catch (err) {
    console.error("[SystemSettings] Failed to refresh settings cache:", err.message);
    return cache;
  }
}

// Initial warm-up (non-blocking)
refreshCache().catch(() => {});

/**
 * Get setting synchronously from cache.
 * Triggers background refresh if cache has expired.
 */
function getSetting(key, fallback = undefined) {
  if (Date.now() - lastFetched > CACHE_TTL_MS) {
    refreshCache().catch(() => {});
  }
  const val = cache[key];
  if (val !== undefined && val !== null) {
    return val;
  }
  return fallback !== undefined ? fallback : defaults[key];
}

/**
 * Get setting asynchronously (ensures fresh read if cache expired).
 */
async function getSettingAsync(key, fallback = undefined) {
  if (Date.now() - lastFetched > CACHE_TTL_MS) {
    await refreshCache();
  }
  const val = cache[key];
  if (val !== undefined && val !== null) {
    return val;
  }
  return fallback !== undefined ? fallback : defaults[key];
}

/**
 * Invalidate cache immediately (called on settings update).
 */
function invalidateCache() {
  lastFetched = 0;
  return refreshCache();
}

module.exports = {
  defaults,
  getSetting,
  getSettingAsync,
  refreshCache,
  invalidateCache,
};
