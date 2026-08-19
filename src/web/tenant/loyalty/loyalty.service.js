const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");

const getWallet = async (db, customerId) => {
  const customer = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  let wallet = await mainPrisma.wallet.findUnique({
    where: { appUserId: customerId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!wallet) {
    // Auto-create global wallet if missing
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customerId, points: 0, lifetimeEarn: 0 },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
  }

  return wallet;
};

/**
 * Award points to a user (e.g. after order completion).
 * @param {object} opts - Optional { orderId, orderNumber, source } to link transaction
 */
const earnPoints = async (db, customerId, points, description, tenantId, opts = {}) => {
  if (tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant) {
      // Main active toggle affects ALL channels
      if (tenant.loyaltyEnabled === false) {
        console.log(`[LOYALTY] Earning points blocked: Loyalty program is globally disabled for tenant ${tenant.name}`);
        return null;
      }
      // Add Points toggle affects POS Cashier channel only
      const source = (opts.source || "").toLowerCase();
      if (source === "pos" && tenant.loyaltyAddPoints === false) {
        console.log(`[LOYALTY] Earning points blocked: Add Points toggle disabled for POS on tenant ${tenant.name}`);
        return null;
      }
    }
  }

  const customer = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  let wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customerId } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customerId, points: 0, lifetimeEarn: 0 },
    });
  }

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { appUserId: customerId },
      data: { points: { increment: points }, lifetimeEarn: { increment: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points,
        description: description || "Points earned",
        tenantId,
        orderId: opts.orderId || null,
        orderNumber: opts.orderNumber || null,
      },
    }),
  ]);

  return updatedWallet;
};

/**
 * Redeem points from a user's wallet.
 * @param {object} opts - Optional { orderId, orderNumber, source } to link transaction
 */
const redeemPoints = async (db, customerId, points, description, tenantId, opts = {}) => {
  if (tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant) {
      // Main active toggle affects ALL channels
      if (tenant.loyaltyEnabled === false) {
        throw new ApiError(400, "Loyalty points program is currently disabled for this brand.");
      }
      // Redeem Points toggle affects POS Cashier channel only
      const source = (opts.source || "").toLowerCase();
      if (source === "pos" && tenant.loyaltyRedeemPoints === false) {
        throw new ApiError(400, "Redeeming loyalty points is currently disabled for POS Cashier.");
      }
    }
  }

  const customer = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  const wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customerId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  if (wallet.points < points) throw new ApiError(400, "Insufficient points");

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { appUserId: customerId },
      data: { points: { decrement: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points: -points,
        description: description || "Points redeemed",
        tenantId,
        orderId: opts.orderId || null,
        orderNumber: opts.orderNumber || null,
      },
    }),
  ]);

  return updatedWallet;
};


const searchCustomers = async (db, search) => {
  const query = search ? search.trim() : "";
  if (!query) return [];

  // Search globally in AppUser registry
  const customers = await mainPrisma.appUser.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    include: { wallet: true },
    take: 15,
  });

  return customers.map(c => ({
    id: c.id,
    name: c.name || "Unnamed",
    phone: c.phone,
    email: c.email,
    points: c.wallet?.points || 0,
  }));
};

const getAllCustomersForReport = async (db, tenantId) => {
  const customers = await mainPrisma.appUser.findMany({
    include: { wallet: true },
    orderBy: { createdAt: "desc" },
  });

  return customers.map(c => ({
    id: c.id,
    name: c.name || "Unnamed",
    phone: c.phone,
    email: c.email,
    points: c.wallet?.points || 0,
    lifetimeEarn: c.wallet?.lifetimeEarn || 0,
    joinedAt: c.createdAt,
  }));
};

const getAllTransactionsForReport = async (db, tenantId) => {
  const transactions = await mainPrisma.walletTransaction.findMany({
    where: { tenantId },
    include: {
      wallet: {
        include: {
          appUser: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return transactions.map((t) => ({
    id: t.id,
    customerName: t.wallet.appUser?.name || "Unnamed",
    customerPhone: t.wallet.appUser?.phone || "",
    points: t.points,
    description: t.description,
    createdAt: t.createdAt,
  }));
};

const createCustomer = async (db, { name, phone, email, points = 0 }, tenantId) => {
  if (!phone) throw new ApiError(400, "Phone number is required");

  let customer = await mainPrisma.appUser.findUnique({ where: { phone } });
  if (customer) {
    throw new ApiError(400, "Customer with this phone already exists");
  } else {
    // Create new global user
    customer = await mainPrisma.appUser.create({
      data: { name, phone, email },
    });
  }

  let wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customer.id } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: customer.id,
        points: points,
        lifetimeEarn: points,
      },
    });
  } else if (points > 0) {
    wallet = await mainPrisma.wallet.update({
      where: { appUserId: customer.id },
      data: {
        points: { increment: points },
        lifetimeEarn: { increment: points },
      },
    });
  }

  if (points > 0) {
    await mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points,
        description: "Starting balance (Staff enrolled)",
        tenantId,
      },
    });
  }
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    points: wallet.points,
    joinedAt: customer.createdAt,
  };
};

/**
 * Reverse points for a refunded order:
 * 1. If points were earned on this order, deduct them from user's wallet.
 * 2. If points were redeemed for this order, refund them back to user's wallet.
 */
const reverseOrderPoints = async (db, customerId, orderNumber, pointsRedeemed, tenantId, orderId) => {
  if (!customerId) return;
  const customer = await mainPrisma.appUser.findUnique({
    where: { id: customerId },
    include: { wallet: true }
  });
  if (!customer || !customer.wallet) return;

  const wallet = customer.wallet;

  // 1. Reverse Earned Points
  const earnTx = await mainPrisma.walletTransaction.findFirst({
    where: {
      walletId: wallet.id,
      points: { gt: 0 },
      OR: [
        { orderNumber: orderNumber },
        { orderId: orderId || "non-existent-id" },
        { description: `Earned on Order #${orderNumber}` },
        { description: `Points earned for Order #${orderNumber}` },
        { description: { contains: orderNumber } },
      ],
    }
  });

  if (earnTx && earnTx.points > 0) {
    const reverseEarnDesc = `Reversed Earned Points (Refund Order #${orderNumber})`;
    const existingRevEarn = await mainPrisma.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        OR: [
          { description: reverseEarnDesc },
          { AND: [{ orderNumber: orderNumber }, { points: { lt: 0 } }] }
        ]
      }
    });
    if (!existingRevEarn) {
      const pointsToDeduct = earnTx.points;
      await mainPrisma.$transaction([
        mainPrisma.wallet.update({
          where: { id: wallet.id },
          data: { points: { decrement: pointsToDeduct }, lifetimeEarn: { decrement: pointsToDeduct } }
        }),
        mainPrisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            points: -pointsToDeduct,
            description: reverseEarnDesc,
            tenantId,
            orderId: orderId || null,
            orderNumber: orderNumber || null
          }
        })
      ]);
    }
  }

  // 2. Reverse Redeemed Points (Refund redeemed points back to customer)
  const redeemedQty = pointsRedeemed && Number(pointsRedeemed) > 0 ? Number(pointsRedeemed) : 0;
  if (redeemedQty > 0) {
    const reverseRedeemDesc = `Refunded Redeemed Points (Refund Order #${orderNumber})`;
    const existingRevRedeem = await mainPrisma.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        OR: [
          { description: reverseRedeemDesc },
          { AND: [{ orderNumber: orderNumber }, { points: { gt: 0 } }, { description: { contains: "Refunded" } }] }
        ]
      }
    });
    if (!existingRevRedeem) {
      await mainPrisma.$transaction([
        mainPrisma.wallet.update({
          where: { id: wallet.id },
          data: { points: { increment: redeemedQty } }
        }),
        mainPrisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            points: redeemedQty,
            description: reverseRedeemDesc,
            tenantId,
            orderId: orderId || null,
            orderNumber: orderNumber || null
          }
        })
      ]);
    }
  }
};

module.exports = {
  getWallet,
  earnPoints,
  redeemPoints,
  reverseOrderPoints,
  searchCustomers,
  getAllCustomersForReport,
  getAllTransactionsForReport,
  createCustomer
};
