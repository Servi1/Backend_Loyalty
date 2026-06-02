/**
 * App Wallet Service
 *
 * getWallet      — full wallet + transaction history
 * getTransactions — paginated transaction history
 */

const ApiError = require("../../utils/ApiError");

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

module.exports = { getWallet, getTransactions };
