const mainPrisma = require('../src/config/prisma');
const { getTenantClient } = require('../src/config/tenantManager');

async function syncTenantOrderTypeDescriptions() {
  console.log("Syncing descriptions from GlobalOrderType to CustomOrderTypes...");
  const globals = await mainPrisma.globalOrderType.findMany();
  const tenants = await mainPrisma.tenant.findMany();

  for (const tenant of tenants) {
    try {
      const db = getTenantClient(tenant.dbUrl);
      for (const g of globals) {
        if (g.description) {
          await db.customOrderType.updateMany({
            where: { name: { equals: g.name, mode: "insensitive" } },
            data: { description: g.description }
          });
        }
      }
      console.log(`✅ Synced descriptions for tenant ${tenant.slug}`);
    } catch (e) {
      console.error(`❌ Sync error for ${tenant.slug}:`, e.message);
    }
  }
}

syncTenantOrderTypeDescriptions().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
