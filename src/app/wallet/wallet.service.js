/**
 * App Wallet Service
 *
 * getWallet      — full wallet + transaction history
 * getTransactions — paginated transaction history
 */

const ApiError = require("../../utils/ApiError");
const { syncToAggregatedCustomer } = require("../../shared/customers/customers.service");

// Helper to normalise phone numbers
const normalisePhone = (raw) => {
  let phone = String(raw).replace(/[\s\-().]/g, "");
  if (!phone.startsWith("+")) phone = "+" + phone;
  return phone;
};

// ─── getWallet ────────────────────────────────────────────────────────────────

const getWallet = async (db, userId) => {
  const wallet = await db.wallet.findUnique({
    where: { userId },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!wallet) throw new ApiError(404, "Wallet not found");

  return {
    id: wallet.id,
    points: wallet.points,
    lifetimeEarn: wallet.lifetimeEarn,
    recentTransactions: wallet.transactions.map(_formatTx),
  };
};

// ─── getTransactions ──────────────────────────────────────────────────────────

const getTransactions = async (db, userId, { page = 1, limit = 30 } = {}) => {
  const wallet = await db.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");

  const skip = (page - 1) * limit;

  const [transactions, total] = await db.$transaction([
    db.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.walletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return {
    walletId: wallet.id,
    points: wallet.points,
    lifetimeEarn: wallet.lifetimeEarn,
    transactions: transactions.map(_formatTx),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: skip + limit < total,
    },
  };
};

// ─── Private helpers ──────────────────────────────────────────────────────────

const _formatTx = (tx) => ({
  id: tx.id,
  points: tx.points,
  type: tx.points >= 0 ? "earn" : "redeem",
  description: tx.description,
  createdAt: tx.createdAt,
});

// ─── transferPoints ────────────────────────────────────────────────────────────

const transferPoints = async (db, tenantId, senderId, { recipientPhone, points, message } = {}) => {
  if (!points || points <= 0 || isNaN(points)) {
    throw new ApiError(400, "Points must be a positive integer");
  }

  const sender = await db.appUser.findUnique({
    where: { id: senderId },
    include: { wallet: true },
  });

  if (!sender || !sender.wallet) {
    throw new ApiError(404, "Sender wallet not found");
  }

  if (sender.wallet.points < points) {
    throw new ApiError(400, "Insufficient points in wallet");
  }

  const normalisedPhone = normalisePhone(recipientPhone);

  const recipient = await db.appUser.findUnique({
    where: { phone: normalisedPhone },
    include: { wallet: true },
  });

  if (!recipient) {
    throw new ApiError(404, `Recipient user not found with phone ${normalisedPhone}`);
  }

  if (recipient.id === sender.id) {
    throw new ApiError(400, "Cannot transfer points to yourself");
  }

  if (!recipient.wallet) {
    throw new ApiError(404, "Recipient wallet not found");
  }

  // Deduct from sender and add to recipient
  await db.$transaction([
    db.wallet.update({
      where: { id: sender.wallet.id },
      data: { points: { decrement: points } },
    }),
    db.walletTransaction.create({
      data: {
        walletId: sender.wallet.id,
        points: -points,
        description: message ? `Sent to ${recipient.name || normalisedPhone}: ${message}` : `Sent to ${recipient.name || normalisedPhone}`,
      },
    }),
    db.wallet.update({
      where: { id: recipient.wallet.id },
      data: {
        points: { increment: points },
        lifetimeEarn: { increment: points },
      },
    }),
    db.walletTransaction.create({
      data: {
        walletId: recipient.wallet.id,
        points: points,
        description: message ? `Received from ${sender.name || sender.phone}: ${message}` : `Received from ${sender.name || sender.phone}`,
      },
    }),
  ]);

  // Sync to global registries (fire and forget / async)
  syncToAggregatedCustomer(db, tenantId, sender.id).catch(console.error);
  syncToAggregatedCustomer(db, tenantId, recipient.id).catch(console.error);

  // Get the updated sender wallet
  const updatedSenderWallet = await db.wallet.findUnique({
    where: { id: sender.wallet.id },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  return {
    id: updatedSenderWallet.id,
    points: updatedSenderWallet.points,
    lifetimeEarn: updatedSenderWallet.lifetimeEarn,
    recentTransactions: updatedSenderWallet.transactions.map(_formatTx),
  };
};

module.exports = { getWallet, getTransactions, transferPoints };
