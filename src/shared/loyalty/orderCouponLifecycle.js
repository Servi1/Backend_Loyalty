const mainPrisma = require("../../config/prisma");

/**
 * Handles coupon status transition and stamp deduction when an order is ACCEPTED by the brand/branch.
 *
 * @param {Object} order - The order object (must have id, orderNumber)
 * @param {string} [tenantId] - Optional tenantId
 */
const handleOrderAcceptedCoupon = async (order, tenantId) => {
  if (!order) return;

  try {
    let coupon = await mainPrisma.earnedCoupon.findFirst({
      where: {
        OR: [
          { orderId: order.id },
          { orderNumber: order.orderNumber }
        ],
        status: "PROCESSING"
      }
    });

    if (!coupon && order.notes) {
      const match = order.notes.match(/\[COUPON:([^\]]+)\]/i);
      if (match && match[1]) {
        coupon = await mainPrisma.earnedCoupon.findFirst({
          where: {
            code: match[1].trim().toUpperCase(),
            status: "PROCESSING"
          }
        });
      }
    }

    if (coupon) {
      await mainPrisma.earnedCoupon.update({
        where: { id: coupon.id },
        data: {
          status: "USED",
          isUsed: true,
          usedAt: new Date(),
          orderId: order.id,
          orderNumber: order.orderNumber,
        }
      });

      // Deduct stamps upon order acceptance
      const appUserId = coupon.appUserId || order.customerId;
      const targetTenantId = tenantId || coupon.tenantId || order.tenantId;
      if (appUserId && targetTenantId) {
        const wallet = await mainPrisma.wallet.findFirst({
          where: { appUserId, tenantId: targetTenantId }
        });
        if (wallet) {
          await mainPrisma.wallet.update({
            where: { id: wallet.id },
            data: { stamps: 0 }
          });
          await mainPrisma.walletTransaction.create({
            data: {
              walletId: wallet.id,
              points: 0,
              description: `Redeemed Stamp Coupon ${coupon.code} for Free Order #${order.orderNumber}`,
              tenantId: targetTenantId
            }
          });
          console.log(`[COUPON ACCEPT] Coupon ${coupon.code} marked USED and stamps reset for order #${order.orderNumber}`);
        }
      }
    }
  } catch (err) {
    console.error(`[COUPON ACCEPT] Error handling coupon acceptance for order #${order?.orderNumber}:`, err.message);
  }
};

/**
 * Handles coupon restoration when an order is CANCELLED (auto-cancelled or rejected/cancelled by brand).
 * Reverts the coupon from PROCESSING back to ACTIVE so the user can use it again.
 *
 * @param {Object} order - The order object (must have id, orderNumber)
 * @param {string} [tenantId] - Optional tenantId
 */
const handleOrderCancelledCoupon = async (order, tenantId) => {
  if (!order) return;

  try {
    let coupon = await mainPrisma.earnedCoupon.findFirst({
      where: {
        OR: [
          { orderId: order.id },
          { orderNumber: order.orderNumber }
        ],
        status: "PROCESSING"
      }
    });

    if (!coupon && order.notes) {
      const match = order.notes.match(/\[COUPON:([^\]]+)\]/i);
      if (match && match[1]) {
        coupon = await mainPrisma.earnedCoupon.findFirst({
          where: {
            code: match[1].trim().toUpperCase(),
            status: "PROCESSING"
          }
        });
      }
    }

    if (coupon) {
      await mainPrisma.earnedCoupon.update({
        where: { id: coupon.id },
        data: {
          status: "ACTIVE",
          isUsed: false,
          usedAt: null,
          orderId: null,
          orderNumber: null,
        }
      });
      console.log(`[COUPON CANCEL] Restored coupon ${coupon.code} back to ACTIVE due to order #${order.orderNumber} cancellation.`);
    }
  } catch (err) {
    console.error(`[COUPON CANCEL] Error restoring coupon for cancelled order #${order?.orderNumber}:`, err.message);
  }
};

module.exports = {
  handleOrderAcceptedCoupon,
  handleOrderCancelledCoupon,
};

