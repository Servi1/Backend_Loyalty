const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const mainPrisma = new MainPrismaClient();
const { getTenantClient } = require("../src/config/tenantManager");

async function clearTodaysOrders() {
  console.log("==================================================");
  console.log("🧹 CLEARING ALL ORDERS & TRANSACTIONS CREATED TODAY");
  console.log("==================================================");

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    console.log(`📅 Target Date Filter: >= ${startOfDay.toISOString()}`);

    // 1. Clear Aggregated Orders from Main DB
    const aggDeleted = await mainPrisma.aggregatedOrder.deleteMany({
      where: { createdAt: { gte: startOfDay } }
    });
    console.log(`🗑️ Main DB: Deleted ${aggDeleted.count} aggregated orders created today.`);

    // 2. Clear Wallet Transactions created today
    const txDeleted = await mainPrisma.walletTransaction.deleteMany({
      where: { createdAt: { gte: startOfDay } }
    });
    console.log(`🗑️ Main DB: Deleted ${txDeleted.count} wallet transactions created today.`);

    // 3. Clear Orders from all Tenant DBs
    const tenants = await mainPrisma.tenant.findMany();
    for (const tenant of tenants) {
      if (!tenant.dbUrl) continue;
      try {
        const tenantDb = getTenantClient(tenant.dbUrl);

        // Delete OrderItems for today's orders
        const itemsDeleted = await tenantDb.orderItem.deleteMany({
          where: { order: { createdAt: { gte: startOfDay } } }
        });

        // Delete Orders for today
        const ordersDeleted = await tenantDb.order.deleteMany({
          where: { createdAt: { gte: startOfDay } }
        });

        console.log(`🏢 Tenant [${tenant.name}]: Deleted ${ordersDeleted.count} orders & ${itemsDeleted.count} order items.`);
      } catch (err) {
        console.error(`⚠️ Tenant [${tenant.name}] Cleanup Error:`, err.message);
      }
    }

    // Reset HTTP Test User wallet points back to 0 for a clean test
    const testUser = await mainPrisma.appUser.findFirst({
      where: { phone: "+966500000999" }
    });
    if (testUser) {
      await mainPrisma.wallet.updateMany({
        where: { appUserId: testUser.id },
        data: { points: 0 }
      });
      console.log(`👤 Reset test user (+966500000999) wallet points to 0.`);
    }

    console.log("==================================================");
    console.log("✨ CLEANUP COMPLETED SUCCESSFULLY");
    console.log("==================================================");

  } catch (err) {
    console.error("❌ Cleanup Failed:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

clearTodaysOrders();
