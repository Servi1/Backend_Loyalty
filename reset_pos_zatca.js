const { PrismaClient: TenantPrismaClient } = require("@prisma/client-tenant");
const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const dotenv = require("dotenv");

dotenv.config();

const mainPrisma = new MainPrismaClient();

async function resetPosDevicesZatca() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log(`Reverting Production POS ZATCA enrollments for ${tenants.length} tenants...`);

    for (const tenant of tenants) {
      console.log(`\nProcessing tenant: ${tenant.slug}`);
      const tenantDb = new TenantPrismaClient({
        datasources: { db: { url: tenant.dbUrl } }
      });

      // Update any POS devices that were set to production mode back to sandbox demo
      const result = await tenantDb.posDevice.updateMany({
        where: {
          OR: [
            { zatcaEnvironment: "production" },
            { zatcaStatus: "PRODUCTION_ACTIVE" }
          ]
        },
        data: {
          zatcaEnvironment: "sandbox",
          zatcaStatus: "COMPLIANCE_PASSED"
        }
      });

      console.log(`✅ Reverted ${result.count} POS devices for tenant "${tenant.slug}" to Sandbox / Demo mode.`);
      await tenantDb.$disconnect();
    }

    console.log("\n🎉 All Production POS ZATCA devices reverted to Sandbox / Demo mode successfully!");
  } catch (err) {
    console.error("Error reverting POS ZATCA devices:", err);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
}

resetPosDevicesZatca();
