const mainPrisma = require("../../config/prisma");

/**
 * Real-time historical eligibility check:
 * Determines if Points or Stamps was enabled for a brand at the exact moment
 * the order was placed (orderCreatedAt).
 *
 * @param {string} tenantId
 * @param {"POINTS" | "STAMPS"} programType
 * @param {Date | string | number} orderCreatedAt
 * @param {object} [tenantObj] Optional pre-fetched tenant object
 * @returns {Promise<boolean>}
 */
const isLoyaltyProgramEnabledAtTime = async (tenantId, programType, orderCreatedAt, tenantObj = null) => {
  if (!tenantId || !orderCreatedAt) return false;

  const orderDate = new Date(orderCreatedAt);
  if (isNaN(orderDate.getTime())) return false;

  const tenant = tenantObj || (await mainPrisma.tenant.findUnique({ where: { id: tenantId } }));
  if (!tenant) return false;

  const type = (programType || "").toUpperCase();

  if (type === "POINTS") {
    // 1. If tenant is currently not subscribed to loyalty points at all
    if (!tenant.subLoyalty) return false;

    // 2. Query any audit logs for POINTS created AFTER the order was placed
    try {
      const laterLogs = await mainPrisma.loyaltyAuditLog.findMany({
        where: {
          tenantId,
          programType: "POINTS",
          createdAt: { gte: orderDate },
        },
        orderBy: { createdAt: "asc" }, // earliest change after order was placed
      });

      if (laterLogs.length > 0) {
        for (const log of laterLogs) {
          if (Array.isArray(log.details)) {
            const statusDiff = log.details.find((d) => d.field === "loyaltyEnabled");
            if (statusDiff) {
              const oldVal = statusDiff.oldValue;
              // oldValue was the state at the time the order was placed!
              return oldVal === "Active" || oldVal === true || oldVal === "Enabled";
            }
          }
        }
      }
    } catch (err) {
      console.error("[LOYALTY CHECK] Error checking audit logs for points:", err.message);
    }

    // If no toggle occurred after order creation, use current tenant setting
    return Boolean(tenant.loyaltyEnabled && tenant.loyaltyAddPoints !== false);
  }

  if (type === "STAMPS") {
    // 1. If tenant is currently not subscribed to stamps at all
    if (!tenant.subStamps) return false;

    // 2. Query any audit logs for STAMPS created AFTER the order was placed
    try {
      const laterLogs = await mainPrisma.loyaltyAuditLog.findMany({
        where: {
          tenantId,
          programType: "STAMPS",
          createdAt: { gte: orderDate },
        },
        orderBy: { createdAt: "asc" }, // earliest change after order was placed
      });

      if (laterLogs.length > 0) {
        for (const log of laterLogs) {
          if (Array.isArray(log.details)) {
            const statusDiff = log.details.find((d) => d.field === "stampEnabled");
            if (statusDiff) {
              const oldVal = statusDiff.oldValue;
              // oldValue was the state at the time the order was placed!
              return oldVal === "Active" || oldVal === true || oldVal === "Enabled";
            }
            const createdDiff = log.details.find((d) => d.field === "stampCardCreated");
            if (createdDiff) {
              // The stamp card was created AFTER the order was placed!
              return false;
            }
            const deletedDiff = log.details.find((d) => d.field === "stampCardDeleted");
            if (deletedDiff) {
              // It was deleted after order was placed, so at order time it was active!
              return true;
            }
          }
        }
      }
    } catch (err) {
      console.error("[LOYALTY CHECK] Error checking audit logs for stamps:", err.message);
    }

    // If no stamp status toggle occurred after the order was placed, check current program
    const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
    const stampProg = stampList[0] || null;
    return Boolean(stampProg && stampProg.enabled !== false);
  }

  return false;
};

/**
 * Checks order notes or metadata tag for explicit snapshot
 */
const isOrderEligibleBySnapshot = (order, programType) => {
  if (!order) return null;
  const notes = order.notes || "";
  const pm = (order.paymentMethod || "").toLowerCase();
  const type = (programType || "").toUpperCase();

  // Explicit coupon claiming case: Free reward order created from claiming a coupon
  // MUST NOT earn any loyalty points or stamps
  const isCouponRewardOrder =
    pm === "coupon" ||
    pm === "free_reward" ||
    notes.includes("Free Stamp Reward") ||
    notes.includes("Stamp Reward Coupon") ||
    (notes.includes("[POINTS_ELIGIBLE:false]") && notes.includes("[STAMPS_ELIGIBLE:false]"));

  if (isCouponRewardOrder) {
    return false;
  }

  if (type === "POINTS") {
    if (notes.includes("[POINTS_ELIGIBLE:false]")) return false;
    if (notes.includes("[POINTS_ELIGIBLE:true]")) return true;
    if (order.loyaltyEarnRate !== undefined && order.loyaltyEarnRate !== null) {
      if (Number(order.loyaltyEarnRate) === 0) return false;
    }
  }

  if (type === "STAMPS") {
    if (notes.includes("[STAMPS_ELIGIBLE:false]")) return false;
    if (notes.includes("[STAMPS_ELIGIBLE:true]")) return true;
  }

  return null; // inconclusive from snapshot, fallback to timeline check
};

/**
 * Comprehensive real-time eligibility check for an order:
 * Checks snapshot on order first; if not present, evaluates historical timeline against LoyaltyAuditLog.
 */
const isOrderEligibleForLoyalty = async (order, tenantId, programType, tenantObj = null) => {
  if (!order) return false;

  // 1. Check direct order snapshot
  const snapshotResult = isOrderEligibleBySnapshot(order, programType);
  if (snapshotResult !== null) {
    return snapshotResult;
  }

  // 2. Perform real-time timeline check based on order.createdAt
  const orderCreatedAt = order.createdAt || new Date();
  return isLoyaltyProgramEnabledAtTime(tenantId, programType, orderCreatedAt, tenantObj);
};

/**
 * Checks if an item from an order matches the brand's loyalty points eligible items configuration.
 */
const isItemEligibleForPoints = (item, eligibleIds, eligibleNames) => {
  if (!item || Number(item.price || 0) === 0) return false;
  const mId = String(item.menuItemId || item.itemId || item.id || "");
  const itName = String(item.name || item.menuItem?.name || "").toLowerCase().trim();
  const matchesId = Boolean(mId && eligibleIds.includes(mId));
  const matchesName = Boolean(
    eligibleNames.length > 0 && itName && eligibleNames.some((en) => itName.includes(en) || en.includes(itName))
  );
  return matchesId || matchesName;
};

/**
 * Calculates eligible spend and points to earn for an order.
 * Rule: If no menu item is added in the loyalty points configuration, no one can earn any points.
 * Only if eligible item is purchased will points be earned on the order.
 */
const calculatePointsForOrder = (orderItems, total, earnRate, tenant) => {
  const eligibleIds = Array.isArray(tenant?.loyaltyEligibleItemIds)
    ? tenant.loyaltyEligibleItemIds.map(String).filter(Boolean)
    : [];
  const eligibleNames = Array.isArray(tenant?.loyaltyEligibleItemNames)
    ? tenant.loyaltyEligibleItemNames.map((n) => String(n).toLowerCase().trim()).filter(Boolean)
    : [];
  const itemPointsMap = tenant?.loyaltyItemPoints && typeof tenant.loyaltyItemPoints === 'object'
    ? tenant.loyaltyItemPoints
    : {};

  // If no menu item is added, no one can earn any points
  if (eligibleIds.length === 0 && eligibleNames.length === 0) {
    return { isEligible: false, eligibleSpend: 0, pointsToEarn: 0 };
  }

  const items = Array.isArray(orderItems) ? orderItems : [];
  let eligibleSpend = 0;
  let hasEligible = false;
  let customPointsTotal = 0;
  let hasCustomItemPoints = false;

  for (const it of items) {
    if (isItemEligibleForPoints(it, eligibleIds, eligibleNames)) {
      hasEligible = true;
      const qty = Number(it.quantity || it.qty || 1);
      const price = Number(it.price || 0);
      eligibleSpend += price * qty;

      const mId = String(it.menuItemId || it.itemId || it.id || '');
      if (mId && itemPointsMap[mId] !== undefined && itemPointsMap[mId] !== null) {
        const pts = Number(itemPointsMap[mId]);
        if (!isNaN(pts) && pts >= 0) {
          customPointsTotal += pts * qty;
          hasCustomItemPoints = true;
        }
      }
    }
  }

  if (!hasEligible || eligibleSpend <= 0) {
    return { isEligible: false, eligibleSpend: 0, pointsToEarn: 0 };
  }

  let pointsToEarn = 0;
  const isItemMode = tenant?.loyaltyEarnMode === "item" || (!tenant?.loyaltyEarnMode && hasCustomItemPoints);
  if (isItemMode && hasCustomItemPoints) {
    pointsToEarn = Math.floor(customPointsTotal);
  } else {
    const spendToCount = total !== undefined && total !== null ? Math.min(Number(total), eligibleSpend) : eligibleSpend;
    const effectiveRate = Number(earnRate || 0);
    pointsToEarn = effectiveRate > 0 ? Math.floor(spendToCount * effectiveRate) : 0;
  }

  return { isEligible: true, eligibleSpend, pointsToEarn };
};

module.exports = {
  isLoyaltyProgramEnabledAtTime,
  isOrderEligibleBySnapshot,
  isOrderEligibleForLoyalty,
  isItemEligibleForPoints,
  calculatePointsForOrder,
};
