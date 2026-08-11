const mainPrisma = require('../src/config/prisma');
const { getTenantClient } = require('../src/config/tenantManager');
const globalOrderTypesService = require('../src/web/admin/order-types/globalOrderTypes.service');

async function migrate() {
  console.log("Migrating tenant databases...");
  const tenants = await mainPrisma.tenant.findMany();
  for (const tenant of tenants) {
    console.log(`Migrating tenant ${tenant.slug}...`);
    try {
      const db = getTenantClient(tenant.dbUrl);
      await db.$executeRawUnsafe(`ALTER TABLE "CustomOrderType" ADD COLUMN IF NOT EXISTS "description" TEXT;`);
      console.log(`✅ Column added for ${tenant.slug}`);
    } catch (e) {
      console.error(`❌ Migration error for ${tenant.slug}:`, e.message);
    }
  }

  console.log("Syncing global order type descriptions...");
  await globalOrderTypesService.getAll();
  console.log("All done!");
}

migrate().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
