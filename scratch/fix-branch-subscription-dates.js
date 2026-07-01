const { PrismaClient } = require("@prisma/client-main");
const { getTenantClient } = require("../src/config/tenantManager");
const dotenv = require("dotenv");
dotenv.config();

const mainPrisma = new PrismaClient();

async function main() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants in main database.`);

    for (const tenant of tenants) {
      console.log(`\nFixing branch subscription dates for tenant: ${tenant.slug}`);
      try {
        const tenantPrisma = getTenantClient(tenant.dbUrl);
        const branches = await tenantPrisma.branch.findMany();
        
        for (const branch of branches) {
          const updateData = {};
          
          if (branch.tablesEnabled && (!branch.tablesSubscribedAt || branch.tablesSubscribedAt.getTime() > branch.createdAt.getTime())) {
            updateData.tablesSubscribedAt = branch.createdAt;
          }
          if (branch.posEnabled && (!branch.posSubscribedAt || branch.posSubscribedAt.getTime() > branch.createdAt.getTime())) {
            updateData.posSubscribedAt = branch.createdAt;
          }
          if (branch.qrEnabled && (!branch.qrSubscribedAt || branch.qrSubscribedAt.getTime() > branch.createdAt.getTime())) {
            updateData.qrSubscribedAt = branch.createdAt;
          }
          if (branch.appServiEnabled && (!branch.appServiSubscribedAt || branch.appServiSubscribedAt.getTime() > branch.createdAt.getTime())) {
            updateData.appServiSubscribedAt = branch.createdAt;
          }
          if (branch.kdsEnabled && !branch.kdsSubscribedAt) {
            updateData.kdsSubscribedAt = branch.createdAt;
          }
          if (branch.cdsEnabled && !branch.cdsSubscribedAt) {
            updateData.cdsSubscribedAt = branch.createdAt;
          }

          if (Object.keys(updateData).length > 0) {
            await tenantPrisma.branch.update({
              where: { id: branch.id },
              data: updateData
            });
            console.log(`  -> Updated branch "${branch.name}":`, Object.keys(updateData));
          } else {
            console.log(`  -> Branch "${branch.name}" is already up to date.`);
          }
        }
      } catch (err) {
        console.error(`  -> Error fixing tenant ${tenant.slug}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Main execution error:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
