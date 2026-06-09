const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");

const getWallet = async (db, userId) => {
  const wallet = await mainPrisma.wallet.findUnique({
    where: { appUserId: userId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  return wallet;
};

/**
 * Award points to a user (e.g. after order completion).
 */
const earnPoints = async (db, userId, points, description, tenantId) => {
  const wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: userId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { appUserId: userId },
      data: { points: { increment: points }, lifetimeEarn: { increment: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: { walletId: wallet.id, points, description: description || "Points earned", tenantId: tenantId || null },
    }),
  ]);

  return updatedWallet;
};

/**
 * Redeem points from a user's wallet.
 */
const redeemPoints = async (db, userId, points, description, tenantId) => {
  const wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: userId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  if (wallet.points < points) throw new ApiError(400, "Insufficient points");

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { appUserId: userId },
      data: { points: { decrement: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: { walletId: wallet.id, points: -points, description: description || "Points redeemed", tenantId: tenantId || null },
    }),
  ]);

  return updatedWallet;
};

const searchCustomers = async (db, search) => {
  const query = search ? search.trim() : "";
  if (!query) return [];

  const customers = await mainPrisma.appUser.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    include: {
      wallet: true,
    },
    take: 20,
  });

  return customers.map((u) => ({
    id: u.id,
    name: u.name || "Unnamed",
    phone: u.phone,
    email: u.email,
    points: u.wallet?.points || 0,
  }));
};

const getAllCustomersForReport = async (db) => {
  const customers = await mainPrisma.appUser.findMany({
    include: { wallet: true },
    orderBy: { createdAt: "desc" },
  });
  return customers.map((u) => ({
    id: u.id,
    name: u.name || "Unnamed",
    phone: u.phone,
    email: u.email,
    points: u.wallet?.points || 0,
    lifetimeEarn: u.wallet?.lifetimeEarn || 0,
    joinedAt: u.createdAt,
  }));
};

const getAllTransactionsForReport = async (db) => {
  const transactions = await mainPrisma.walletTransaction.findMany({
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
    customerName: t.wallet?.appUser?.name || "Unnamed",
    customerPhone: t.wallet?.appUser?.phone || "",
    points: t.points,
    description: t.description,
    createdAt: t.createdAt,
  }));
};

const createCustomer = async (db, { name, phone, email, points = 0 }, tenantId) => {
  let user = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        phone ? { phone } : null,
        email ? { email } : null,
      ].filter(Boolean),
    },
  });

  if (user) {
    throw new ApiError(400, "Customer with this phone or email already registered");
  }

  user = await mainPrisma.appUser.create({
    data: {
      name,
      phone,
      email,
    },
  });

  const wallet = await mainPrisma.wallet.create({
    data: {
      appUserId: user.id,
      points,
      lifetimeEarn: points,
    },
  });

  if (points > 0) {
    await mainPrisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        points,
        description: "Starting balance (Staff enrolled)",
        tenantId: tenantId || null,
      },
    });
  }

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    points,
    joinedAt: user.createdAt,
  };
};

module.exports = {
  getWallet,
  earnPoints,
  redeemPoints,
  searchCustomers,
  getAllCustomersForReport,
  getAllTransactionsForReport,
  createCustomer
};
