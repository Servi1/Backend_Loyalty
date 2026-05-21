const mainPrisma = require("./src/config/prisma");
const { getTenantClient } = require("./src/config/tenantManager");

const clearAllOrders = async () => {
  console.log("🧹 Clearing all orders...");
  try {
    // 1. Delete all aggregated orders in main DB
    const deleteMain = await mainPrisma.aggregatedOrder.deleteMany({});
    console.log(`Deleted ${deleteMain.count} aggregated orders from main DB.`);

    // 2. Fetch all tenants to clear their local database orders
    const tenants = await mainPrisma.tenant.findMany({});
    for (const tenant of tenants) {
      try {
        console.log(`Clearing orders for tenant: ${tenant.name}...`);
        const tenantDb = getTenantClient(tenant.dbUrl);
        
        // Delete OrderItem first (foreign key constraints)
        const deleteItems = await tenantDb.orderItem.deleteMany({});
        const deleteOrders = await tenantDb.order.deleteMany({});
        console.log(`- Deleted ${deleteItems.count} order items and ${deleteOrders.count} orders for ${tenant.name}.`);
      } catch (err) {
        console.error(`- Failed to clear orders for tenant ${tenant.name}:`, err.message);
      }
    }
    console.log("✅ All orders cleared successfully!");
  } catch (err) {
    console.error("Error during order cleanup:", err.message);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
};

clearAllOrders();
