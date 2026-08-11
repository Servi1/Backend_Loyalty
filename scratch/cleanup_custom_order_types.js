const path = require("path");
const dotenv = require("d:/Servi/Backend_Loyalty/node_modules/dotenv");
dotenv.config({ path: "d:/Servi/Backend_Loyalty/.env" });

const mainPrisma = require("d:/Servi/Backend_Loyalty/src/config/prisma.js");
const { getTenantClient } = require("d:/Servi/Backend_Loyalty/src/config/tenantManager.js");

async function cleanup() {
  try {
    console.log("Fetching all tenants...");
    const tenants = await mainPrisma.tenant.findMany();
    
    for (const tenant of tenants) {
      console.log(`\n============================================`);
      console.log(`Tenant: ${tenant.slug} (${tenant.name})`);
      
      const dbUrl = tenant.dbUrl || process.env.DATABASE_URL;
      if (!dbUrl) {
        console.log("No DB URL found.");
        continue;
      }
      
      const db = getTenantClient(dbUrl);
      
      console.log("Deleting existing custom order types...");
      const deleted = await db.customOrderType.deleteMany({});
      console.log(`-> Deleted ${deleted.count} old order types.`);
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  } finally {
    await mainPrisma.$disconnect();
    console.log("\nCleanup complete.");
  }
}

cleanup();
