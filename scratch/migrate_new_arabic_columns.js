const { PrismaClient } = require("@prisma/client-main");
const mainPrisma = new PrismaClient();
const { getTenantClient } = require("../src/config/tenantManager");

async function run() {
  try {
    console.log("Migrating Main DB columns...");
    const mainSqls = [
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "subStamps" BOOLEAN DEFAULT false;`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "priceStamps" DOUBLE PRECISION DEFAULT 0.0;`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "cycleStamps" TEXT DEFAULT 'monthly';`,
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "feeStamps" DOUBLE PRECISION DEFAULT 0.0;`,
      `ALTER TABLE "GlobalOrderType" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;`,
      `ALTER TABLE "GlobalOrderType" ADD COLUMN IF NOT EXISTS "descriptionAr" TEXT;`,
      `ALTER TABLE "TenantCategory" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;`
    ];

    for (const sql of mainSqls) {
      await mainPrisma.$executeRawUnsafe(sql);
    }
    console.log("Main DB columns added successfully.");

    const tenantSqls = [
      `ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;`,
      `ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;`,
      `ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;`,
      `ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "iconUrl" TEXT;`,
      `ALTER TABLE "CustomOrderType" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;`,
      `ALTER TABLE "CustomOrderType" ADD COLUMN IF NOT EXISTS "descriptionAr" TEXT;`
    ];

    const tenants = await mainPrisma.tenant.findMany();
    for (const t of tenants) {
      if (t.dbUrl) {
        try {
          const tenantDb = getTenantClient(t.dbUrl);
          for (const sql of tenantSqls) {
            await tenantDb.$executeRawUnsafe(sql);
          }
          console.log("Migrated tenant DB for:", t.name);
        } catch (e) {
          console.error("Tenant DB migration error for " + t.name + ":", e.message);
        }
      }
    }
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

run();
