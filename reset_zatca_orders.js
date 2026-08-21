const { PrismaClient: TenantPrismaClient } = require("@prisma/client-tenant");
const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const dotenv = require("dotenv");

dotenv.config();

const mainPrisma = new MainPrismaClient();

async function resetZatcaOrders() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log(`Resetting ZATCA order statuses for ${tenants.length} tenants...`);

    for (const tenant of tenants) {
      console.log(`\nProcessing tenant: ${tenant.slug}`);
      const tenantDb = new TenantPrismaClient({
        datasources: { db: { url: tenant.dbUrl } }
      });
      
      const result = await tenantDb.order.updateMany({
        data: {
          zatcaStatus: "PENDING",
          zatcaReported: false,
          zatcaError: null,
          zatcaReportedAt: null
        }
      });

      console.log(`✅ Reset ${result.count} orders for tenant "${tenant.slug}" to PENDING status.`);
      await tenantDb.$disconnect();
    }

    console.log("\n🎉 All tenant ZATCA order statuses reset successfully!");
  } catch (err) {
    console.error("Error resetting ZATCA order statuses:", err);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
}

resetZatcaOrders();
