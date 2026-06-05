const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");

const getWallet = async (db, customerId) => {
  const customer = await mainPrisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  let wallet = await mainPrisma.wallet.findUnique({
    where: { customerId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!wallet) {
    // Auto-create global wallet if missing
    wallet = await mainPrisma.wallet.create({
      data: { customerId, points: 0, lifetimeEarn: 0 },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
  }

  return wallet;
};

/**
 * Award points to a user (e.g. after order completion).
 */
const earnPoints = async (db, customerId, points, description, tenantId) => {
  const customer = await mainPrisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  let wallet = await mainPrisma.wallet.findUnique({ where: { customerId } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { customerId, points: 0, lifetimeEarn: 0 },
    });
  }

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { customerId },
      data: { points: { increment: points }, lifetimeEarn: { increment: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: { walletId: wallet.id, points, description: description || "Points earned", tenantId },
    }),
  ]);

  return updatedWallet;
};

/**
 * Redeem points from a user's wallet.
 */
const redeemPoints = async (db, customerId, points, description, tenantId) => {
  const customer = await mainPrisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError(404, "Customer not found");

  const wallet = await mainPrisma.wallet.findUnique({ where: { customerId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  if (wallet.points < points) throw new ApiError(400, "Insufficient points");

  const [updatedWallet] = await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { customerId },
      data: { points: { decrement: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: { walletId: wallet.id, points: -points, description: description || "Points redeemed", tenantId },
    }),
  ]);

  return updatedWallet;
};

const searchCustomers = async (db, search) => {
  const query = search ? search.trim() : "";
  if (!query) return [];

  // Search globally in Customer registry
  const customers = await mainPrisma.customer.findMany({
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
  const customers = await mainPrisma.customer.findMany({
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
          customer: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return transactions.map((t) => ({
    id: t.id,
    customerName: t.wallet.customer?.name || "Unnamed",
    customerPhone: t.wallet.customer?.phone || "",
    points: t.points,
    description: t.description,
    createdAt: t.createdAt,
  }));
};

const createCustomer = async (db, { name, phone, email, points = 0 }, tenantId) => {
  if (!phone) throw new ApiError(400, "Phone number is required");

  let customer = await mainPrisma.customer.findUnique({ where: { phone } });
  if (customer) {
    throw new ApiError(400, "Customer with this phone already exists");
  } else {
    // Create new global customer
    customer = await mainPrisma.customer.create({
      data: { name, phone, email },
    });
  }

  let wallet = await mainPrisma.wallet.findUnique({ where: { customerId: customer.id } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: {
        customerId: customer.id,
        points: points,
        lifetimeEarn: points,
      },
    });
  } else if (points > 0) {
    wallet = await mainPrisma.wallet.update({
      where: { customerId: customer.id },
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

module.exports = { 
  getWallet, 
  earnPoints, 
  redeemPoints, 
  searchCustomers, 
  getAllCustomersForReport, 
  getAllTransactionsForReport,
  createCustomer
};
