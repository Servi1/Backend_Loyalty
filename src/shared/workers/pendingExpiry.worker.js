const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");
const loyaltyService = require("../../web/tenant/loyalty/loyalty.service");

const EXPIRY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function checkAndCancelUnacceptedOrders() {
  try {
    const tenants = await mainPrisma.tenant.findMany({
      where: { isActive: true }
    });

    const cutoffTime = new Date(Date.now() - EXPIRY_TIMEOUT_MS);

    for (const tenant of tenants) {
      const dbUrl = tenant.dbUrl || process.env.DATABASE_URL;
      if (!dbUrl) continue;

      try {
        const db = getTenantClient(dbUrl);

        // Find pending orders older than 5 minutes that haven't been accepted
        const unacceptedOrders = await db.order.findMany({
          where: {
            status: "PENDING",
            createdAt: { lt: cutoffTime }
          },
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            pointsRedeemed: true,
            paymentMethod: true,
          }
        });

        if (unacceptedOrders.length > 0) {
          console.log(`[Pending Expiry Worker] Found ${unacceptedOrders.length} unaccepted orders older than 5 mins for tenant: ${tenant.slug}`);
          
          for (const order of unacceptedOrders) {
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
              console.warn(`[Pending Expiry Worker] Failed to update global Order registry: ${err.message}`);
            }

            // 3. Update in main database AggregatedOrder registry
            try {
              await mainPrisma.aggregatedOrder.update({
                where: { id: `${tenant.id}_${order.id}` },
                data: { status: "CANCELLED" }
              });
            } catch (err) {
              console.warn(`[Pending Expiry Worker] Failed to update AggregatedOrder registry: ${err.message}`);
            }

            // 4. Reverse/Refund points as a transaction entry if paid or redeemed via points
            if (order.customerId) {
              try {
                await loyaltyService.reverseOrderPoints(
                  db,
                  order.customerId,
                  order.orderNumber,
                  order.pointsRedeemed,
                  tenant.id,
                  order.id
                );
              } catch (pointsErr) {
                console.error(`[Pending Expiry Worker] Failed to refund points for order ${order.orderNumber}:`, pointsErr.message);
              }
            }

            console.log(`[Pending Expiry Worker] Cancelled unaccepted order #${order.orderNumber} (exceeded 5 mins without POS acceptance)`);
          }
        }
      } catch (tenantErr) {
        console.error(`[Pending Expiry Worker] Error scanning tenant database ${tenant.slug}:`, tenantErr.message);
      }
    }
  } catch (error) {
    console.error("[Pending Expiry Worker] Fatal error checking pending orders:", error);
  }
}

function start() {
  // Run once immediately on startup
  checkAndCancelUnacceptedOrders();

  // Run every 30 seconds
  setInterval(() => {
    checkAndCancelUnacceptedOrders();
  }, 30 * 1000);

  console.log("[Pending Expiry Worker] Started background unaccepted orders auto-cancellation service (runs every 30 seconds).");
}

module.exports = {
  start,
  checkAndCancelUnacceptedOrders,
};
