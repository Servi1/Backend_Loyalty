const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function migrate() {
  console.log("Starting full Arabic columns migration across all databases...");

  // 1. Migrate Main Database (servio_main)
  const mainPatches = [
    'ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "crNameAr" TEXT;',
    'ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "vatNameAr" TEXT;',
    'ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "addressStreetAr" TEXT;',
    'ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "addressCityAr" TEXT;',
    'ALTER TABLE "TenantCategory" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "GlobalOrderType" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "GlobalOrderType" ADD COLUMN IF NOT EXISTS "descriptionAr" TEXT;'
  ];

  for (const sql of mainPatches) {
    try {
      await mainPrisma.$executeRawUnsafe(sql);
      console.log("Main DB Patch applied:", sql);
    } catch (e) {
      console.warn("Main DB Patch notice:", e.message);
    }
  }

  // 2. Migrate All Tenant Databases
  const tenantPatches = [
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "designationAr" TEXT;',
    'ALTER TABLE "CustomRole" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "CustomRole" ADD COLUMN IF NOT EXISTS "descriptionAr" TEXT;',
    'ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "bioAr" TEXT;',
    'ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "receiptAdditionalTextAr" TEXT;',
    'ALTER TABLE "Table" ADD COLUMN IF NOT EXISTS "labelAr" TEXT;',
    'ALTER TABLE "Table" ADD COLUMN IF NOT EXISTS "zoneAr" TEXT;',
    'ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;',
    'ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "iconUrl" TEXT;',
    'ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "unitAr" TEXT;',
    'ALTER TABLE "PosDevice" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "KdsDevice" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "Discount" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "titleAr" TEXT;',
    'ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "termsAr" TEXT;',
    'ALTER TABLE "CustomPaymentType" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "LocationGroup" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "ProductRequest" ADD COLUMN IF NOT EXISTS "detailsAr" TEXT;',
    'ALTER TABLE "ProductRequest" ADD COLUMN IF NOT EXISTS "reasonAr" TEXT;',
    'ALTER TABLE "CustomOrderType" ADD COLUMN IF NOT EXISTS "nameAr" TEXT;',
    'ALTER TABLE "CustomOrderType" ADD COLUMN IF NOT EXISTS "descriptionAr" TEXT;'
  ];

  const tenants = await mainPrisma.tenant.findMany({
    select: { id: true, name: true, dbUrl: true }
  });

  for (const t of tenants) {
    if (!t.dbUrl) continue;
    console.log(`\nMigrating tenant DB: ${t.name} (${t.id})...`);
    try {
      const db = getTenantClient(t.dbUrl);
      for (const sql of tenantPatches) {
        try {
          await db.$executeRawUnsafe(sql);
        } catch (err) {
          console.warn(`  [${t.name}] Notice on patch:`, err.message);
        }
      }
      console.log(`Successfully patched tenant DB: ${t.name}`);
    } catch (e) {
      console.error(`Failed to patch tenant DB for ${t.name}:`, e.message);
    }
  }

  console.log("\nAll migrations completed successfully!");
  process.exit(0);
}

migrate();
