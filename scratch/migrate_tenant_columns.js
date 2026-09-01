const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function migrateAll() {
  const tenants = await mainPrisma.tenant.findMany();
  for (const t of tenants) {
    const url = t.dbUrl || t.databaseUrl;
    if (!url) continue;
    try {
      const db = getTenantClient(url);
      console.log("Migrating tenant DB:", t.name);
      await db.$executeRawUnsafe('ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "rating" DOUBLE PRECISION DEFAULT 4.8;').catch(e => console.error(e.message));
      await db.$executeRawUnsafe('ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "ratingCount" INTEGER DEFAULT 0;').catch(e => console.error(e.message));
      await db.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rating" DOUBLE PRECISION DEFAULT 5.0;').catch(e => console.error(e.message));
      await db.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ratingCount" INTEGER DEFAULT 0;').catch(e => console.error(e.message));
      console.log("SUCCESS for tenant DB:", t.name);
    } catch (e) {
      console.error("Failed for tenant:", t.name, e.message);
    }
  }
  process.exit(0);
}

migrateAll();
