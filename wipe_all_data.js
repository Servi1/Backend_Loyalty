const mainPrisma = require("./src/config/prisma");
const { getTenantClient } = require("./src/config/tenantManager");

const wipeData = async () => {
  console.log("🧹 Starting full data wipe (wallets & orders)...");
  try {
    // 1. Delete all wallet transactions in main DB
    const deleteWalletTx = await mainPrisma.walletTransaction.deleteMany({});
    console.log(`- Deleted ${deleteWalletTx.count} wallet transactions from main DB.`);

    // 2. Reset all wallet balances (points = 0, lifetimeEarn = 0)
    const updateWallets = await mainPrisma.wallet.updateMany({
      data: { points: 0, lifetimeEarn: 0 }
    });
    console.log(`- Reset ${updateWallets.count} customer wallets to 0 points & 0 lifetime earn.`);

    // 3. Delete all aggregated orders in main DB
    const deleteAggregated = await mainPrisma.aggregatedOrder.deleteMany({});
    console.log(`- Deleted ${deleteAggregated.count} aggregated orders from main DB.`);

    // 4. Delete all main DB orders (app orders / global orders)
    const deleteMainOrders = await mainPrisma.order.deleteMany({});
    console.log(`- Deleted ${deleteMainOrders.count} main DB orders.`);

    // 5. Fetch all tenants to clear their local database orders
    const tenants = await mainPrisma.tenant.findMany({});
    console.log(`Found ${tenants.length} tenants. Clearing tenant database orders...`);
    for (const tenant of tenants) {
      try {
        console.log(`Clearing orders for tenant: ${tenant.name} (${tenant.slug})...`);
        const tenantDb = getTenantClient(tenant.dbUrl);
        
        // Delete OrderItem first (foreign key constraint)
        const deleteItems = await tenantDb.orderItem.deleteMany({});
        const deleteOrders = await tenantDb.order.deleteMany({});
        console.log(`- [${tenant.name}] Deleted ${deleteItems.count} order items and ${deleteOrders.count} orders.`);
      } catch (err) {
        console.error(`- Failed to clear orders for tenant ${tenant.name}:`, err.message);
      }
    }

    console.log("\n🎉 CLEAN SLATE WIPE COMPLETE!");
    console.log("All customer wallets reset to 0 points.");
    console.log("All order records and wallet transactions cleared successfully.");

  } catch (err) {
    console.error("❌ Error during data wipe:", err.message);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
};

wipeData();
