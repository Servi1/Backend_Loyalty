const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");
const loyaltyService = require("../../web/tenant/loyalty/loyalty.service");

const REGULAR_EXPIRY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for regular orders
const SCHEDULED_EXPIRY_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours for scheduled orders

/**
 * Checks whether an order is scheduled (via type, selectedSlot, selectedSlotDate, or slotDetails)
 */
function isScheduledOrder(order) {
  return (
    order.type === "SCHEDULED" ||
    Boolean(order.selectedSlot) ||
    Boolean(order.selectedSlotDate) ||
    (order.slotDetails && Array.isArray(order.slotDetails) && order.slotDetails.length > 0)
  );
}

/**
 * Checks whether the scheduled date and time slot has already passed
 */
function hasSlotTimePassed(slotDate, slotTime) {
  if (!slotDate) return false;
  try {
    let dateStr = "";
    if (slotDate instanceof Date) {
      dateStr = slotDate.toISOString().split("T")[0];
    } else if (typeof slotDate === "string") {
      dateStr = slotDate.split("T")[0].trim();
    }
    if (!dateStr) return false;

    // Default to end of day if no specific slot time is given
    let hours = 23;
    let minutes = 59;
    let seconds = 59;

    if (typeof slotTime === "string" && slotTime.trim()) {
      // If slotTime is a range e.g. "14:00 - 14:30", take the end time
      const parts = slotTime.split("-");
      const targetTimePart = (parts[parts.length - 1] || parts[0]).trim();
      const match = targetTimePart.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
        seconds = 0;
      }
    }

    const dateParts = dateStr.split("-").map((p) => parseInt(p, 10));
    if (dateParts.length >= 3) {
      const slotEndDateTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, seconds);
      if (!isNaN(slotEndDateTime.getTime())) {
        return Date.now() > slotEndDateTime.getTime();
      }
    }
  } catch (err) {
    console.warn("[Pending Expiry Worker] Failed to check slot time:", err.message);
  }
  return false;
}

async function checkAndCancelUnacceptedOrders() {
  try {
    const tenants = await mainPrisma.tenant.findMany({
      where: { isActive: true },
    });

    const now = Date.now();

    for (const tenant of tenants) {
      const dbUrl = tenant.dbUrl || process.env.DATABASE_URL;
      if (!dbUrl) continue;

      try {
        const db = getTenantClient(dbUrl);

        // Find all pending orders that have not been accepted yet
        const unacceptedOrders = await db.order.findMany({
          where: {
            status: "PENDING",
          },
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            tableId: true,
            notes: true,
            pointsRedeemed: true,
            paymentMethod: true,
            type: true,
            selectedSlot: true,
            selectedSlotDate: true,
            slotDetails: true,
            createdAt: true,
          },
        });

        if (unacceptedOrders.length > 0) {
          for (const order of unacceptedOrders) {
            const scheduled = isScheduledOrder(order);
            const orderAgeMs = now - new Date(order.createdAt).getTime();

            let shouldCancel = false;
            let cancelReason = "";

            if (!scheduled) {
              // Regular orders auto-cancel after 5 minutes without POS acceptance
              if (orderAgeMs > REGULAR_EXPIRY_TIMEOUT_MS) {
                shouldCancel = true;
                cancelReason = "exceeded 5 mins without POS acceptance";
              }
            } else {
              // Scheduled orders auto-cancel after 24 hours OR when the slot time passes
              if (orderAgeMs > SCHEDULED_EXPIRY_TIMEOUT_MS) {
                shouldCancel = true;
                cancelReason = "scheduled order exceeded 24 hours without POS acceptance";
              } else if (hasSlotTimePassed(order.selectedSlotDate, order.selectedSlot)) {
                shouldCancel = true;
                cancelReason = `scheduled slot time has passed (${order.selectedSlotDate || ""} ${order.selectedSlot || ""})`.trim();
              } else if (order.slotDetails && Array.isArray(order.slotDetails) && order.slotDetails.length > 0) {
                const anyPassed = order.slotDetails.some((sd) =>
                  hasSlotTimePassed(sd.selectedSlotDate || order.selectedSlotDate, sd.selectedSlot)
                );
                if (anyPassed) {
                  shouldCancel = true;
                  cancelReason = "scheduled specialist slot time has passed";
                }
              }
            }

            if (!shouldCancel) continue;

            // 1. Update status to CANCELLED in tenant database
            // Note: Once cancelled, slot check queries (filtering status not in CANCELLED/REFUNDED)
            // will immediately see this slot as released and available for other customers.
            await db.order.update({
              where: { id: order.id },
              data: { status: "CANCELLED" },
            });

            // 2. Update status in main database Order registry
            try {
              await mainPrisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELLED" },
              });
            } catch (err) {
              console.warn(`[Pending Expiry Worker] Failed to update global Order registry: ${err.message}`);
            }

            // 3. Update status in main database AggregatedOrder registry
            try {
              await mainPrisma.aggregatedOrder.update({
                where: { id: `${tenant.id}_${order.id}` },
                data: { status: "CANCELLED" },
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

            // 5. Restore coupon back to ACTIVE if order had a coupon in PROCESSING
            try {
              const { handleOrderCancelledCoupon } = require("../loyalty/orderCouponLifecycle");
              await handleOrderCancelledCoupon(order, tenant.id);
            } catch (couponErr) {
              console.warn(`[Pending Expiry Worker] Failed to restore coupon for order ${order.orderNumber}: ${couponErr.message}`);
            }

            console.log(
              `[Pending Expiry Worker] Cancelled unaccepted order #${order.orderNumber} (${cancelReason}). Slot released.`
            );
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

  console.log(
    "[Pending Expiry Worker] Started background unaccepted orders auto-cancellation service (runs every 30 seconds, 5m regular, 24h/passed-slot scheduled)."
  );
}

module.exports = {
  start,
  checkAndCancelUnacceptedOrders,
  isScheduledOrder,
  hasSlotTimePassed,
};
