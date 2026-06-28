const { syncAllTenantOrders } = require("./src/web/admin/tenants/tenants.service");
const mainPrisma = require("./src/config/prisma");

const run = async () => {
  try {
    await syncAllTenantOrders();
  } catch (err) {
    console.error("Sync error:", err);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
};

run();
