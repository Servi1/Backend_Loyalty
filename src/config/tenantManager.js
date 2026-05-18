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

  // Store it in the cache
  tenantClients.set(dbUrl, client);

  return client;
};

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
