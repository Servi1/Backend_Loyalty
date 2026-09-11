const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const { PrismaClient: TenantPrismaClient } = require("@prisma/client-tenant");
const dotenv = require("dotenv");

dotenv.config();

const mainPrisma = new MainPrismaClient();

async function main() {
  try {
    console.log("🧹 Starting cleanup of all orders and associated points...");

    // 1. Delete all WalletTransactions
    const deletedTxs = await mainPrisma.walletTransaction.deleteMany({});
    console.log(`✅ Deleted ${deletedTxs.count} wallet transactions from main DB.`);

    // 2. Reset all Wallets
    const resetWallets = await mainPrisma.wallet.updateMany({
      data: {
        points: 0,
        lifetimeEarn: 0,
        tier: "bronze",
      },
    });
    console.log(`✅ Reset ${resetWallets.count} wallets to 0 points.`);

    // 3. Delete main DB orders & aggregated orders
    const deletedAggOrders = await mainPrisma.aggregatedOrder.deleteMany({});
    console.log(`✅ Deleted ${deletedAggOrders.count} aggregated orders from main DB.`);

    const deletedMainOrders = await mainPrisma.order.deleteMany({});
    console.log(`✅ Deleted ${deletedMainOrders.count} orders from main DB.`);

    // 4. Delete orders & order items from all tenant DBs
    const tenants = await mainPrisma.tenant.findMany();
    for (const tenant of tenants) {
      console.log(`\nCleaning tenant DB for ${tenant.slug}...`);
      try {
        const tenantPrisma = new TenantPrismaClient({
          datasources: { db: { url: tenant.dbUrl } },
        });

        const deletedItems = await tenantPrisma.orderItem.deleteMany({});
        console.log(`  - Deleted ${deletedItems.count} order items.`);

        const deletedTenantOrders = await tenantPrisma.order.deleteMany({});
        console.log(`  - Deleted ${deletedTenantOrders.count} orders.`);

        await tenantPrisma.$disconnect();
      } catch (err) {
        console.error(`  ❌ Error cleaning tenant ${tenant.slug}:`, err.message);
      }
    }

    console.log("\n🎉 All orders and loyalty points reset successfully!");
  } catch (err) {
    console.error("❌ Cleanup error:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

main();
