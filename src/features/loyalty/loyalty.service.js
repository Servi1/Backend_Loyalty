const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");

const getWallet = async (userId) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  return wallet;
};

/**
 * Award points to a user (e.g. after order completion).
 */
const earnPoints = async (userId, points, description) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");

  const [updatedWallet] = await prisma.$transaction([
    prisma.wallet.update({
      where: { userId },
      data: { points: { increment: points }, lifetimeEarn: { increment: points } },
    }),
    prisma.walletTransaction.create({
      data: { walletId: wallet.id, points, description: description || "Points earned" },
    }),
  ]);

  return updatedWallet;
};

/**
 * Redeem points from a user's wallet.
 */
const redeemPoints = async (userId, points, description) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  if (wallet.points < points) throw new ApiError(400, "Insufficient points");

  const [updatedWallet] = await prisma.$transaction([
    prisma.wallet.update({
      where: { userId },
      data: { points: { decrement: points } },
    }),
    prisma.walletTransaction.create({
      data: { walletId: wallet.id, points: -points, description: description || "Points redeemed" },
    }),
  ]);

  return updatedWallet;
};

module.exports = { getWallet, earnPoints, redeemPoints };
