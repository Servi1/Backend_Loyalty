const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");

const DEFAULT_LOYALTY_TIERS = [
  {
    id: "starter",
    name: "Starter",
    level: 1,
    icon: "⭐",
    minOrders: 0,
    minPurchaseValue: 0,
    dailyCap: 0,
    dailyCapType: "blocked",
    status: "active"
  },
  {
    id: "bronze",
    name: "Bronze",
    level: 2,
    icon: "🥉",
    minOrders: 10,
    minPurchaseValue: 100,
    dailyCap: 100,
    dailyCapType: "capped",
    status: "active"
  },
  {
    id: "silver",
    name: "Silver",
    level: 3,
    icon: "🥈",
    minOrders: 30,
    minPurchaseValue: 450,
    dailyCap: 300,
    dailyCapType: "capped",
    status: "active"
  },
  {
    id: "gold",
    name: "Gold",
    level: 4,
    icon: "🥇",
    minOrders: 40,
    minPurchaseValue: 600,
    dailyCap: 500,
    dailyCapType: "capped",
    status: "active"
  },
  {
    id: "platinum",
    name: "Platinum",
    level: 5,
    icon: "💎",
    minOrders: 50,
    minPurchaseValue: 1000,
    dailyCap: null,
    dailyCapType: "unlimited",
    status: "active"
  }
];

const getCustomerTierDetails = (customer, wallet, configuredTiers) => {
  const tiers = Array.isArray(configuredTiers) && configuredTiers.length > 0
    ? configuredTiers
    : DEFAULT_LOYALTY_TIERS;

  const ordersCount = customer?.completedOrdersCount || customer?.ratingCount || 0;
  const lifetimeSpend = customer?.lifetimeSpend || (wallet ? wallet.lifetimeEarn : 0) || 0;

  const sortedTiers = [...tiers].sort((a, b) => Number(b.level || 0) - Number(a.level || 0));

  for (const tier of sortedTiers) {
    if (tier.status === "active") {
      const minOrders = Number(tier.minOrders || 0);
      const minSpend = Number(tier.minPurchaseValue || 0);
      if (ordersCount >= minOrders && lifetimeSpend >= minSpend) {
        return tier;
      }
    }
  }

  return sortedTiers[sortedTiers.length - 1] || DEFAULT_LOYALTY_TIERS[0];
};

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
  let tenantTiers = DEFAULT_LOYALTY_TIERS;

  if (tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant) {
      if (Array.isArray(tenant.loyaltyTiers) && tenant.loyaltyTiers.length > 0) {
        tenantTiers = tenant.loyaltyTiers;
      }
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

  // Prevent duplicate points earning for the exact same order
  if (opts.orderId || opts.orderNumber) {
    const existingTx = await mainPrisma.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        points: { gt: 0 },
        OR: [
          opts.orderId ? { orderId: opts.orderId } : undefined,
          opts.orderNumber ? { orderNumber: opts.orderNumber } : undefined,
          opts.orderNumber ? { description: { contains: opts.orderNumber } } : undefined,
        ].filter(Boolean),
      },
    });

    if (existingTx) {
      console.log(`[LOYALTY] Earning points skipped: Points already awarded for order ${opts.orderNumber || opts.orderId}`);
      return wallet;
    }
  }

  // Determine Tier and Daily Cap
  const customerTier = getCustomerTierDetails(customer, wallet, tenantTiers);

  if (customerTier.dailyCapType === "blocked" || customerTier.dailyCap === 0) {
    console.log(`[LOYALTY] Points earning blocked: Customer tier "${customerTier.name}" is Blocked from earning points.`);
    return wallet;
  }

  let finalPointsToEarn = points;

  if (customerTier.dailyCapType === "capped" && Number(customerTier.dailyCap) > 0) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayTxs = await mainPrisma.walletTransaction.aggregate({
      _sum: { points: true },
      where: {
        walletId: wallet.id,
        points: { gt: 0 },
        createdAt: { gte: startOfDay },
      },
    });

    const earnedToday = todayTxs._sum.points || 0;
    const remainingCap = Math.max(0, Number(customerTier.dailyCap) - earnedToday);

    if (remainingCap <= 0) {
      console.log(`[LOYALTY] Points earning skipped: Daily cap of ${customerTier.dailyCap} pts reached for tier ${customerTier.name}.`);
      return wallet;
    }

    finalPointsToEarn = Math.min(points, remainingCap);
  }

  if (finalPointsToEarn <= 0) return wallet;

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { appUserId: customerId },
      data: { points: { increment: finalPointsToEarn }, lifetimeEarn: { increment: finalPointsToEarn } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points: finalPointsToEarn,
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

  // Prevent duplicate points redemption for the exact same order
  if (opts.orderId || opts.orderNumber) {
    const existingRedeemTx = await mainPrisma.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        points: { lt: 0 },
        OR: [
          opts.orderId ? { orderId: opts.orderId } : undefined,
          opts.orderNumber ? { orderNumber: opts.orderNumber } : undefined,
          opts.orderNumber ? { description: { contains: opts.orderNumber } } : undefined,
        ].filter(Boolean),
      },
    });

    if (existingRedeemTx) {
      console.log(`[LOYALTY] Points redemption skipped: Points already redeemed for order ${opts.orderNumber || opts.orderId}`);
      return wallet;
    }
  }

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

  return customers.map(c => {
    const tier = getCustomerTierDetails(c, c.wallet, DEFAULT_LOYALTY_TIERS);
    return {
      id: c.id,
      name: c.name || "Unnamed",
      phone: c.phone,
      email: c.email,
      points: c.wallet?.points || 0,
      tier: tier.name,
      tierLevel: tier.level,
      tierIcon: tier.icon,
    };
  });
};

const getAllCustomersForReport = async (db, tenantId) => {
  let configuredTiers = DEFAULT_LOYALTY_TIERS;
  if (tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant && Array.isArray(tenant.loyaltyTiers) && tenant.loyaltyTiers.length > 0) {
      configuredTiers = tenant.loyaltyTiers;
    }
  }

  const customers = await mainPrisma.appUser.findMany({
    include: { wallet: true },
    orderBy: { createdAt: "desc" },
  });

  return customers.map(c => {
    const tier = getCustomerTierDetails(c, c.wallet, configuredTiers);
    return {
      id: c.id,
      name: c.name || "Unnamed",
      phone: c.phone,
      email: c.email,
      points: c.wallet?.points || 0,
      lifetimeEarn: c.wallet?.lifetimeEarn || 0,
      joinedAt: c.createdAt,
      tier: tier.name,
      tierLevel: tier.level,
      tierIcon: tier.icon,
    };
  });
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

const getTiers = async (tenantId) => {
  let tiers = DEFAULT_LOYALTY_TIERS;
  if (tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant && Array.isArray(tenant.loyaltyTiers) && tenant.loyaltyTiers.length > 0) {
      tiers = tenant.loyaltyTiers;
    }
  }

  const allUsers = await mainPrisma.appUser.findMany({
    include: { wallet: true }
  });

  const memberCounts = {};
  for (const user of allUsers) {
    const t = getCustomerTierDetails(user, user.wallet, tiers);
    memberCounts[t.id] = (memberCounts[t.id] || 0) + 1;
  }

  return tiers.map((tier) => ({
    ...tier,
    membersCount: memberCounts[tier.id] || 0,
  }));
};

const updateTiers = async (tenantId, tiers) => {
  if (!Array.isArray(tiers)) throw new ApiError(400, "Tiers must be an array");

  if (tenantId) {
    await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: { loyaltyTiers: tiers }
    });
  }

  return getTiers(tenantId);
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
  DEFAULT_LOYALTY_TIERS,
  getWallet,
  earnPoints,
  redeemPoints,
  reverseOrderPoints,
  searchCustomers,
  getAllCustomersForReport,
  getAllTransactionsForReport,
  createCustomer,
  getTiers,
  updateTiers,
};
