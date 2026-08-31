const { PrismaClient } = require("@prisma/client-tenant");

// Cache to store PrismaClient instances per database URL
const tenantClients = new Map();

/**
 * Get or create a PrismaClient instance for a specific tenant database URL.
 * 
 * @param {string} dbUrl - The PostgreSQL connection string for the tenant DB.
 * @returns {PrismaClient} - The PrismaClient connected to the tenant DB.
 */
const getTenantClient = (dbUrl) => {
  if (!dbUrl) {
    throw new Error("A database URL is required to get a tenant client");
  }

  // Check if we already have an active client for this URL
  if (tenantClients.has(dbUrl)) {
    return tenantClients.get(dbUrl);
  }

  // If not, instantiate a new client pointing to the specific tenant DB
  const client = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

  // Automatically patch schema for newly added tenant columns
  ensureTenantColumns(client).catch((err) => {
    console.warn(`[Tenant DB Schema Patch] Warning updating schema for ${dbUrl.slice(-15)}:`, err.message);
  });

  // Store it in the cache
  tenantClients.set(dbUrl, client);

  return client;
};

/**
 * Safely ensures newly defined tenant columns exist on existing tenant databases.
 */
async function ensureTenantColumns(client) {
  try {
    const patches = [
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "rating" INTEGER;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "comment" TEXT;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "staffRating" INTEGER;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "staffComment" TEXT;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaXml" TEXT;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaQrCode" TEXT;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaHash" TEXT;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaIcv" INTEGER;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaPih" TEXT;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaReported" BOOLEAN DEFAULT false;',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaReportedAt" TIMESTAMP(3);',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaStatus" TEXT DEFAULT \'PENDING\';',
      'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "zatcaError" TEXT;',
      'ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "googleMapsUrl" TEXT;'
    ];
    for (const patch of patches) {
      await client.$executeRawUnsafe(patch).catch(() => null);
    }
  } catch (e) {
    // Ignore migration warning if tenant DB is unavailable
  }
}

/**
 * Disconnect and remove a client from the cache (useful for cleanup or when a tenant is deleted).
 */
const removeTenantClient = async (dbUrl) => {
  if (tenantClients.has(dbUrl)) {
    const client = tenantClients.get(dbUrl);
    await client.$disconnect();
    tenantClients.delete(dbUrl);
  }
};

module.exports = {
  getTenantClient,
  removeTenantClient,
};
