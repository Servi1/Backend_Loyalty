const mainPrisma = require("../src/config/prisma");

async function run() {
  try {
    const tenants = await mainPrisma.tenant.findMany();
    console.log("=== Tenants Subscription Settings ===");
    tenants.forEach(t => {
      console.log(`Tenant: ${t.name} (${t.slug})`);
      console.log(`  subQrTable: ${t.subQrTable}`);
      console.log(`  subQrCashier: ${t.subQrCashier}`);
      console.log(`  feeQrTable: ${t.feeQrTable}`);
      console.log(`  feeQrCashier: ${t.feeQrCashier}`);
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

run();
