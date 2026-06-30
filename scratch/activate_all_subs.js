const mainPrisma = require("../src/config/prisma");

async function run() {
  try {
    console.log("Activating QR Table and QR Cashier takeaway ordering for all brands...");
    const result = await mainPrisma.tenant.updateMany({
      data: {
        subQrTable: true,
        subQrCashier: true,
      },
    });
    console.log(`Updated ${result.count} tenants successfully!`);
  } catch (err) {
    console.error("Error activating subscriptions:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

run();
