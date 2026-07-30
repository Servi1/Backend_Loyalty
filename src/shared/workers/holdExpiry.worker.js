const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");

const EXPIRY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

async function checkAndExpireHoldOrders() {
  try {
    console.log("[Hold Expiry Worker] Scanning tenants for holding orders older than 1 hour...");
    const tenants = await mainPrisma.tenant.findMany({
      where: { isActive: true }
    });

    const cutoffTime = new Date(Date.now() - EXPIRY_TIMEOUT_MS);

    for (const tenant of tenants) {
      const dbUrl = tenant.dbUrl || process.env.DATABASE_URL;
      if (!dbUrl) continue;

      try {
        const db = getTenantClient(dbUrl);

        // Find expired holding orders
        const expiredOrders = await db.order.findMany({
          where: {
            status: "HALTED",
            createdAt: { lt: cutoffTime }
          }
        });

        if (expiredOrders.length > 0) {
          console.log(`[Hold Expiry Worker] Found ${expiredOrders.length} expired orders for tenant: ${tenant.slug}`);
          
          for (const order of expiredOrders) {
            // 1. Update in tenant database
            await db.order.update({
              where: { id: order.id },
              data: { status: "CANCELLED" }
            });

            // 2. Update in main database Order registry
            try {
              await mainPrisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELLED" }
              });
            } catch (err) {
              console.warn(`[Hold Expiry Worker] Failed to update global Order registry: ${err.message}`);
            }

            // 3. Update in main database AggregatedOrder registry
            try {
              await mainPrisma.aggregatedOrder.update({
                where: { id: `${tenant.id}_${order.id}` },
                data: { status: "CANCELLED" }
              });
            } catch (err) {
              console.warn(`[Hold Expiry Worker] Failed to update AggregatedOrder registry: ${err.message}`);
            }

            console.log(`[Hold Expiry Worker] Cancelled expired hold order ${order.orderNumber}`);
          }
        }
      } catch (tenantErr) {
        console.error(`[Hold Expiry Worker] Error scanning tenant database ${tenant.slug}:`, tenantErr.message);
      }
    }
  } catch (error) {
    console.error("[Hold Expiry Worker] Fatal error checking hold orders:", error);
  }
}

function start() {
  // Run once immediately on startup
  checkAndExpireHoldOrders();

  // Run every 5 minutes (300000 ms)
  setInterval(() => {
    checkAndExpireHoldOrders();
  }, 5 * 60 * 1000);

  console.log("[Hold Expiry Worker] Started background expiration service (runs every 5 minutes).");
}

module.exports = {
  start
};
