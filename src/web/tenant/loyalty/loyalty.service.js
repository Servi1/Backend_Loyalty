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

const normalizePhone = (rawPhone) => {
  if (!rawPhone) return "";
  let digits = rawPhone.toString().trim().replace(/[\s\-\(\)]/g, "");
  if (digits.startsWith("00966")) {
    digits = "+966" + digits.substring(5);
  }
  if (digits.startsWith("+966")) {
    let rest = digits.substring(4);
    if (rest.startsWith("0")) rest = rest.substring(1);
    return "+966" + rest;
  }
  if (digits.startsWith("966")) {
    let rest = digits.substring(3);
    if (rest.startsWith("0")) rest = rest.substring(1);
    return "+966" + rest;
  }
  if (digits.startsWith("0")) {
    digits = digits.substring(1);
  }
  if (/^5\d{8}$/.test(digits)) {
    return "+966" + digits;
  }
  if (!digits.startsWith("+") && digits.length >= 9) {
    return "+966" + digits;
  }
  return digits.startsWith("+") ? digits : `+${digits}`;
};

const getPhoneDigitsKey = (rawPhone) => {
  if (!rawPhone) return "";
  const norm = normalizePhone(rawPhone);
  const digits = norm.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
};

const getCustomerTierDetails = (customer, wallet, configuredTiers) => {
  const tiers = Array.isArray(configuredTiers) && configuredTiers.length > 0
    ? configuredTiers
    : DEFAULT_LOYALTY_TIERS;

  if (wallet && wallet.tier) {
    const targetTierName = String(wallet.tier).trim().toLowerCase();
    const matchedTier = tiers.find(
      (t) => (t.id || "").toLowerCase() === targetTierName || (t.name || "").toLowerCase() === targetTierName
    );
    if (matchedTier) {
      return matchedTier;
    }
  }

  const ordersCount = Number(customer?.completedOrdersCount || customer?.ratingCount || 0);
  const lifetimeSpend = Number(customer?.lifetimeSpend || (wallet ? Math.max(wallet.lifetimeEarn || 0, wallet.points || 0) : 0) || 0);

  const sortedTiers = [...tiers].sort((a, b) => Number(b.level || 0) - Number(a.level || 0));

  for (const tier of sortedTiers) {
    if (tier.status === "active") {
      const minOrders = Number(tier.minOrders || 0);
      const minSpend = Number(tier.minPurchaseValue || 0);

      const satisfiesOrders = minOrders === 0 || ordersCount >= minOrders;
      const satisfiesSpend = minSpend === 0 || lifetimeSpend >= minSpend;

      if (satisfiesOrders && satisfiesSpend) {
        return tier;
      }
    }
  }

  return sortedTiers[sortedTiers.length - 1] || DEFAULT_LOYALTY_TIERS[0];
};

const resolveTenant = async (tenantId) => {
  if (!tenantId) return null;
  return mainPrisma.tenant.findFirst({
    where: { OR: [{ id: tenantId }, { slug: tenantId }] }
  });
};

const getWallet = async (db, customerId, tenantId = null) => {
  const customer = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  let targetTenantId = tenantId;
  if (tenantId) {
    const tenant = await resolveTenant(tenantId);
    if (tenant) targetTenantId = tenant.id;
  }

  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: customerId, tenantId: targetTenantId || null },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customerId, tenantId: targetTenantId || null, points: 0, lifetimeEarn: 0 },
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
  let targetTenantId = tenantId;

  if (tenantId) {
    const tenant = await resolveTenant(tenantId);
    if (tenant) {
      targetTenantId = tenant.id;
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

  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: customerId, tenantId: targetTenantId || null },
  });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customerId, tenantId: targetTenantId || null, points: 0, lifetimeEarn: 0 },
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

  // Determine Tier
  const customerTier = getCustomerTierDetails(customer, wallet, tenantTiers);

  // Earning points is UNLIMITED
  const finalPointsToEarn = points;
  if (finalPointsToEarn <= 0) return wallet;

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { id: wallet.id },
      data: { points: { increment: finalPointsToEarn }, lifetimeEarn: { increment: finalPointsToEarn } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points: finalPointsToEarn,
        description: description || "Points earned",
        tenantId: targetTenantId || null,
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
  let tenantTiers = DEFAULT_LOYALTY_TIERS;
  let targetTenantId = tenantId;

  if (tenantId) {
    const tenant = await resolveTenant(tenantId);
    if (tenant) {
      targetTenantId = tenant.id;
      if (Array.isArray(tenant.loyaltyTiers) && tenant.loyaltyTiers.length > 0) {
        tenantTiers = tenant.loyaltyTiers;
      }
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

  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: customerId, tenantId: targetTenantId || null },
  });
  if (!wallet) throw new ApiError(404, "Wallet not found for this brand");
  if (wallet.points < points) throw new ApiError(400, `Insufficient points for this brand. Order requires ${points} pts, but available balance is ${wallet.points} pts.`);

  // Enforce Tier Daily Redemption Cap
  const customerTier = getCustomerTierDetails(customer, wallet, tenantTiers);

  if (customerTier.dailyCapType === "blocked" || customerTier.dailyCap === 0) {
    throw new ApiError(400, `Point redemption is blocked for ${customerTier.name} tier.`);
  }

  if (customerTier.dailyCapType === "capped" && Number(customerTier.dailyCap) > 0) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayRedeemTxs = await mainPrisma.walletTransaction.aggregate({
      _sum: { points: true },
      where: {
        walletId: wallet.id,
        points: { lt: 0 },
        createdAt: { gte: startOfDay },
      },
    });

    const redeemedToday = Math.abs(todayRedeemTxs._sum.points || 0);
    const dailyCap = Number(customerTier.dailyCap);
    const remainingRedeemCap = Math.max(0, dailyCap - redeemedToday);

    if (remainingRedeemCap <= 0) {
      throw new ApiError(400, `Daily redemption cap of ${dailyCap} pts reached for ${customerTier.name} tier.`);
    }

    if (points > remainingRedeemCap) {
      throw new ApiError(400, `Cannot redeem ${points} pts. Your remaining daily redemption cap for ${customerTier.name} tier is ${remainingRedeemCap} pts.`);
    }
  }

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
      where: { id: wallet.id },
      data: { points: { decrement: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points: -points,
        description: description || "Points redeemed",
        tenantId: targetTenantId || null,
        orderId: opts.orderId || null,
        orderNumber: opts.orderNumber || null,
      },
    }),
  ]);

  return updatedWallet;
};

const searchCustomers = async (db, search, tenantId = null) => {
  const query = search ? search.trim() : "";
  if (!query) return [];
  const cleanDigits = query.replace(/\D/g, "");

  const searchConditions = [
    { name: { contains: query, mode: "insensitive" } },
    { phone: { contains: query, mode: "insensitive" } },
    { email: { contains: query, mode: "insensitive" } },
  ];
  if (cleanDigits) {
    searchConditions.push({ phone: { contains: cleanDigits, mode: "insensitive" } });
  }

  // Search globally in AppUser registry with tenant-filtered wallets
  const customers = await mainPrisma.appUser.findMany({
    where: { OR: searchConditions },
    include: { wallets: tenantId ? { where: { tenantId } } : true },
    take: 15,
  });

  return customers.map(c => {
    const wallet = tenantId ? c.wallets.find(w => w.tenantId === tenantId) : c.wallets[0];
    const tier = getCustomerTierDetails(c, wallet, DEFAULT_LOYALTY_TIERS);
    return {
      id: c.id,
      name: c.name || "Unnamed",
      phone: c.phone,
      email: c.email,
      points: wallet?.points || 0,
      tier: tier.name,
      tierLevel: tier.level,
      tierIcon: tier.icon,
    };
  });
};

const getCustomerByPhone = async (db, phone, tenantId = null) => {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  const customer = await mainPrisma.appUser.findUnique({
    where: { phone: normalized },
    include: { wallets: tenantId ? { where: { tenantId } } : true },
  });
  if (!customer) return null;
  const wallet = tenantId ? customer.wallets.find(w => w.tenantId === tenantId) : customer.wallets[0];
  const tier = getCustomerTierDetails(customer, wallet, DEFAULT_LOYALTY_TIERS);
  return {
    id: customer.id,
    name: customer.name || "Unnamed",
    phone: customer.phone,
    email: customer.email,
    points: wallet?.points || 0,
    tier: tier.name,
    tierLevel: tier.level,
    tierIcon: tier.icon,
  };
};

const getAllCustomersForReport = async (db, tenantId = null) => {
  let configuredTiers = DEFAULT_LOYALTY_TIERS;
  if (tenantId) {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant && Array.isArray(tenant.loyaltyTiers) && tenant.loyaltyTiers.length > 0) {
      configuredTiers = tenant.loyaltyTiers;
    }
  }

  const [customers, allAggregatedOrders, allMainOrders] = await Promise.all([
    mainPrisma.appUser.findMany({
      include: { wallets: tenantId ? { where: { tenantId } } : true },
      orderBy: { createdAt: "desc" },
    }),
    mainPrisma.aggregatedOrder.findMany({
      where: { status: "COMPLETED", ...(tenantId && { tenantId }) },
      select: { customerPhone: true, total: true }
    }),
    mainPrisma.order.findMany({
      where: { status: "COMPLETED", ...(tenantId && { tenantId }) },
      select: { appUserId: true, total: true }
    })
  ]);

  const statsByUserId = {};
  for (const ord of allMainOrders) {
    if (ord.appUserId) {
      if (!statsByUserId[ord.appUserId]) statsByUserId[ord.appUserId] = { count: 0, spend: 0 };
      statsByUserId[ord.appUserId].count += 1;
      statsByUserId[ord.appUserId].spend += Number(ord.total || 0);
    }
  }

  const statsByPhoneKey = {};
  for (const ord of allAggregatedOrders) {
    if (ord.customerPhone) {
      const key = getPhoneDigitsKey(ord.customerPhone);
      if (key) {
        if (!statsByPhoneKey[key]) statsByPhoneKey[key] = { count: 0, spend: 0 };
        statsByPhoneKey[key].count += 1;
        statsByPhoneKey[key].spend += Number(ord.total || 0);
      }
    }
  }

  return customers.map(c => {
    const wallet = tenantId ? c.wallets.find(w => w.tenantId === tenantId) : c.wallets[0];

    const userIdStats = statsByUserId[c.id] || { count: 0, spend: 0 };
    const phoneKey = getPhoneDigitsKey(c.phone);
    const phoneStats = phoneKey ? (statsByPhoneKey[phoneKey] || { count: 0, spend: 0 }) : { count: 0, spend: 0 };

    const completedOrdersCount = Math.max(userIdStats.count, phoneStats.count);
    const lifetimeSpendFromOrders = Math.max(userIdStats.spend, phoneStats.spend);
    const walletEarned = wallet ? Number(wallet.lifetimeEarn || 0) : 0;
    const walletPoints = wallet ? Number(wallet.points || 0) : 0;
    const lifetimeSpend = Math.max(lifetimeSpendFromOrders, walletEarned, walletPoints);

    const userWithStats = {
      ...c,
      completedOrdersCount,
      lifetimeSpend
    };

    const tier = getCustomerTierDetails(userWithStats, wallet, configuredTiers);
    return {
      id: c.id,
      name: c.name || "Unnamed",
      phone: c.phone,
      email: c.email,
      points: wallet?.points || 0,
      lifetimeEarn: wallet?.lifetimeEarn || 0,
      completedOrdersCount,
      lifetimeSpend,
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
  const normalizedPhone = normalizePhone(phone);

  let customer = await mainPrisma.appUser.findUnique({ where: { phone: normalizedPhone } });
  if (customer) {
    throw new ApiError(400, "Customer with this phone already exists");
  } else {
    // Create new global user
    customer = await mainPrisma.appUser.create({
      data: { name, phone: normalizedPhone, email },
    });
  }

  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: customer.id, tenantId: tenantId || null },
  });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: customer.id,
        tenantId: tenantId || null,
        points: points,
        lifetimeEarn: points,
      },
    });
  } else if (points > 0) {
    wallet = await mainPrisma.wallet.update({
      where: { id: wallet.id },
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
    include: {
      wallets: tenantId ? { where: { tenantId } } : true
    }
  });

  const [allAggregatedOrders, allMainOrders] = await Promise.all([
    mainPrisma.aggregatedOrder.findMany({
      where: {
        status: "COMPLETED",
        ...(tenantId && { tenantId })
      },
      select: { orderId: true, customerPhone: true, customerName: true, total: true }
    }),
    mainPrisma.order.findMany({
      where: {
        status: "COMPLETED",
        ...(tenantId && { tenantId })
      },
      select: { id: true, appUserId: true, total: true }
    })
  ]);

  const statsByUserId = {};
  for (const ord of allMainOrders) {
    if (ord.appUserId) {
      if (!statsByUserId[ord.appUserId]) statsByUserId[ord.appUserId] = { count: 0, spend: 0 };
      statsByUserId[ord.appUserId].count += 1;
      statsByUserId[ord.appUserId].spend += Number(ord.total || 0);
    }
  }

  const statsByPhoneKey = {};
  for (const ord of allAggregatedOrders) {
    if (ord.customerPhone) {
      const key = getPhoneDigitsKey(ord.customerPhone);
      if (key) {
        if (!statsByPhoneKey[key]) statsByPhoneKey[key] = { count: 0, spend: 0 };
        statsByPhoneKey[key].count += 1;
        statsByPhoneKey[key].spend += Number(ord.total || 0);
      }
    }
  }

  const memberCounts = {};
  const memberDetails = {};
  for (const user of allUsers) {
    const userWallet = (tenantId && Array.isArray(user.wallets))
      ? user.wallets.find((w) => w.tenantId === tenantId) || user.wallets[0] || null
      : (Array.isArray(user.wallets) ? user.wallets[0] : null);

    const userIdStats = statsByUserId[user.id] || { count: 0, spend: 0 };
    const phoneKey = getPhoneDigitsKey(user.phone);
    const phoneStats = phoneKey ? (statsByPhoneKey[phoneKey] || { count: 0, spend: 0 }) : { count: 0, spend: 0 };

    const completedOrdersCount = Math.max(userIdStats.count, phoneStats.count);
    const lifetimeSpendFromOrders = Math.max(userIdStats.spend, phoneStats.spend);
    const walletEarned = userWallet ? Number(userWallet.lifetimeEarn || 0) : 0;
    const walletPoints = userWallet ? Number(userWallet.points || 0) : 0;
    const lifetimeSpend = Math.max(lifetimeSpendFromOrders, walletEarned, walletPoints);

    const userWithStats = {
      ...user,
      completedOrdersCount,
      lifetimeSpend
    };

    const t = getCustomerTierDetails(userWithStats, userWallet, tiers);
    memberCounts[t.id] = (memberCounts[t.id] || 0) + 1;
    if (!memberDetails[t.id]) memberDetails[t.id] = [];
    memberDetails[t.id].push({
      id: user.id,
      name: user.name || "Walk-in Customer",
      phone: user.phone || "N/A",
      email: user.email || "N/A",
      points: userWallet?.points || 0,
      lifetimeEarn: userWallet?.lifetimeEarn || 0,
      completedOrdersCount,
      lifetimeSpend,
      createdAt: user.createdAt
    });
  }

  return tiers.map((tier) => ({
    ...tier,
    membersCount: memberCounts[tier.id] || 0,
    members: memberDetails[tier.id] || []
  }));
};

const updateTiers = async (tenantId, tiers) => {
  if (!Array.isArray(tiers)) throw new ApiError(400, "Tiers must be an array");

  const cleanedTiers = tiers.map(({ membersCount, ...tier }) => tier);

  if (tenantId) {
    await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: { loyaltyTiers: cleanedTiers }
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
    include: { wallets: true }
  });
  if (!customer) return;

  const wallet = await getWallet(db, customerId, tenantId);
  if (!wallet) return;

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
  getCustomerTierDetails,
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
