/**
 * App Wallet Service
 * 
 * Rewired to use the global main database (mainPrisma).
 */

const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");

// Helper to normalise phone numbers (defaulting to Saudi international +966)
const normalisePhone = (raw) => {
  if (!raw) return "";
  let phone = String(raw).replace(/[\s\-().]/g, "");
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("00")) return "+" + phone.slice(2);
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (phone.startsWith("966")) return "+" + phone;
  return "+966" + phone;
};

// Auto-revert gifts older than 3 days (72 hours) back to sender's wallet
const processExpiredGifts = async () => {
  try {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const expiryThreshold = new Date(Date.now() - THREE_DAYS_MS);

    const expiredGifts = await mainPrisma.gift.findMany({
      where: {
        claimed: false,
        createdAt: { lt: expiryThreshold }
      },
      include: {
        sender: { include: { wallet: true } },
        recipient: true
      }
    });

    for (const gift of expiredGifts) {
      if (gift.sender && gift.sender.wallet) {
        let recipientDisplay = gift.recipient?.name || gift.recipient?.phone || "recipient";
        let isCard = false;
        let cardTheme = "";
        if (gift.message && gift.message.startsWith("{")) {
          try {
            const parsed = JSON.parse(gift.message);
            if (parsed.isGiftCard) {
              isCard = true;
              cardTheme = parsed.theme || "Gift Card";
              if (parsed.recipientName) recipientDisplay = parsed.recipientName;
            }
          } catch (e) {}
        }

        const desc = isCard
          ? `Refund: Unclaimed Gift Card (${cardTheme}) to ${recipientDisplay} expired after 3 days`
          : `Refund: Unclaimed gift to ${recipientDisplay} expired after 3 days`;

        await mainPrisma.$transaction([
          mainPrisma.gift.update({
            where: { id: gift.id },
            data: {
              claimed: true,
              message: gift.message ? gift.message + " [EXPIRED_REVERTED]" : "[EXPIRED_REVERTED]"
            }
          }),
          mainPrisma.wallet.update({
            where: { id: gift.sender.wallet.id },
            data: { points: { increment: gift.points } }
          }),
          mainPrisma.walletTransaction.create({
            data: {
              walletId: gift.sender.wallet.id,
              points: gift.points,
              description: desc
            }
          })
        ]);
      }
    }
  } catch (err) {
    console.error("Error processing expired gifts:", err);
  }
};

// ─── verifyUser ──────────────────────────────────────────────────────────────
const verifyUser = async (currentUserId, rawPhone) => {
  if (!rawPhone || !rawPhone.trim()) {
    throw new ApiError(400, "Mobile number is required");
  }

  const phone = normalisePhone(rawPhone);

  const targetUser = await mainPrisma.appUser.findFirst({
    where: { phone, isDelete: false },
    select: { id: true, name: true, phone: true }
  });

  if (!targetUser) {
    throw new ApiError(404, "User does not exist");
  }

  if (targetUser.id === currentUserId) {
    throw new ApiError(400, "Cannot send points or gift cards to yourself");
  }

  return {
    id: targetUser.id,
    name: targetUser.name || targetUser.phone,
    phone: targetUser.phone
  };
};

// ─── Private helpers ──────────────────────────────────────────────────────────

const _formatTx = (tx) => {
  const desc = (tx.description || "").toLowerCase();
  let type = tx.points >= 0 ? "earn" : "redeem";
  if (desc.includes("refund") || desc.includes("reverse")) {
    type = "refunded";
  } else if (desc.includes("gift sent") || desc.includes("transferred to") || desc.includes("transfer out")) {
    type = "transferred";
  } else if (desc.includes("claimed gift") || desc.includes("transferred from") || desc.includes("received gift")) {
    type = "received";
  }
  return {
    id: tx.id,
    points: tx.points,
    type,
    description: tx.description,
    createdAt: tx.createdAt,
  };
};

const _formatGiftDate = (date) => {
  try {
    const d = new Date(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  } catch {
    return '';
  }
};

// ─── getWallet ────────────────────────────────────────────────────────────────

const getWallet = async (db, userId, tenantId = null) => {
  await processExpiredGifts();
  const wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: userId, tenantId: tenantId || null },
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

const getTransactions = async (db, userId, { page = 1, limit = 30, tenantId = null } = {}) => {
  const wallet = await mainPrisma.wallet.findFirst({ where: { appUserId: userId, tenantId: tenantId || null } });
  if (!wallet) throw new ApiError(404, "Wallet not found");

  const skip = (page - 1) * limit;

  const [transactions, total] = await mainPrisma.$transaction([
    mainPrisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    mainPrisma.walletTransaction.count({ where: { walletId: wallet.id } }),
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

// ─── transferPoints ────────────────────────────────────────────────────────────

const transferPoints = async (db, tenantId, senderId, { recipientPhone, points, message } = {}) => {
  if (!points || points <= 0 || isNaN(points)) {
    throw new ApiError(400, "Points must be a positive integer");
  }

  const sender = await mainPrisma.appUser.findUnique({
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

  const recipient = await mainPrisma.appUser.findUnique({
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

  // Deduct from sender and create a pending Gift record in mainPrisma
  await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { id: sender.wallet.id },
      data: { points: { decrement: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: sender.wallet.id,
        points: -points,
        description: message ? `Gift sent to ${recipient.name || normalisedPhone}: ${message}` : `Gift sent to ${recipient.name || normalisedPhone}`,
        tenantId: tenantId || null,
      },
    }),
    mainPrisma.gift.create({
      data: {
        senderId: sender.id,
        recipientId: recipient.id,
        points,
        message,
        claimed: false
      }
    })
  ]);

  return getWallet(db, senderId);
};

// ─── sendGiftCard ─────────────────────────────────────────────────────────────

const sendGiftCard = async (db, tenantId, senderId, { recipientPhone, points, theme, senderName, recipientName, message } = {}) => {
  if (!points || points <= 0 || isNaN(points)) {
    throw new ApiError(400, "Points must be a positive integer");
  }

  const sender = await mainPrisma.appUser.findUnique({
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

  const recipient = await mainPrisma.appUser.findUnique({
    where: { phone: normalisedPhone },
    include: { wallet: true },
  });

  if (!recipient) {
    throw new ApiError(404, `Recipient user not found with phone ${normalisedPhone}`);
  }

  if (recipient.id === sender.id) {
    throw new ApiError(400, "Cannot send a gift card to yourself");
  }

  if (!recipient.wallet) {
    throw new ApiError(404, "Recipient wallet not found");
  }

  // Construct a gift card message that contains the gift card metadata
  const giftCardPayload = {
    isGiftCard: true,
    theme,
    senderName: senderName || sender.name || sender.phone,
    recipientName: recipientName || recipient.name || normalisedPhone,
    message: message || ""
  };

  const dbMessage = JSON.stringify(giftCardPayload);

  await mainPrisma.$transaction([
    mainPrisma.wallet.update({
      where: { id: sender.wallet.id },
      data: { points: { decrement: points } },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: sender.wallet.id,
        points: -points,
        description: `Gift Card (${theme}) sent to ${recipientName || recipient.name || normalisedPhone}`,
        tenantId: tenantId || null,
      },
    }),
    mainPrisma.gift.create({
      data: {
        senderId: sender.id,
        recipientId: recipient.id,
        points,
        message: dbMessage,
        claimed: false
      }
    })
  ]);

  return getWallet(db, senderId);
};

// ─── getGifts ──────────────────────────────────────────────────────────────────

const getGifts = async (db, userId) => {
  await processExpiredGifts();
  const gifts = await mainPrisma.gift.findMany({
    where: { recipientId: userId },
    include: {
      sender: {
        select: {
          name: true,
          phone: true,
        }
      }
    },
    orderBy: { createdAt: "desc" },
  });

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  return gifts.map(g => {
    let displayMessage = g.message || "";
    let senderName = g.sender.name || g.sender.phone;
    let theme = null;

    if (g.message && g.message.startsWith("{")) {
      try {
        const parsed = JSON.parse(g.message);
        if (parsed.isGiftCard) {
          displayMessage = parsed.message || "";
          senderName = parsed.senderName || senderName;
          theme = parsed.theme || null;
        }
      } catch (e) {
        // Fallback to raw message if parsing fails
      }
    }

    const expiresAtDate = new Date(new Date(g.createdAt).getTime() + THREE_DAYS_MS);

    return {
      id: g.id,
      name: senderName,
      date: _formatGiftDate(g.createdAt),
      createdAt: g.createdAt,
      expiresAt: expiresAtDate.toISOString(),
      message: displayMessage,
      points: g.points,
      claimed: g.claimed,
      isExpired: g.message ? g.message.includes("[EXPIRED_REVERTED]") : false,
      theme,
    };
  });
};

// ─── claimGift ─────────────────────────────────────────────────────────────────

const claimGift = async (db, tenantId, userId, giftId) => {
  await processExpiredGifts();
  const gift = await mainPrisma.gift.findUnique({
    where: { id: giftId },
    include: {
      sender: true,
      recipient: {
        include: { wallet: true }
      }
    }
  });

  if (!gift) throw new ApiError(404, "Gift not found");
  if (gift.recipientId !== userId) throw new ApiError(403, "You are not authorized to claim this gift");
  if (gift.claimed) throw new ApiError(400, "Gift has already been claimed");

  const recipientWallet = gift.recipient.wallet;
  if (!recipientWallet) throw new ApiError(404, "Recipient wallet not found");

  await mainPrisma.$transaction([
    mainPrisma.gift.update({
      where: { id: giftId },
      data: { claimed: true },
    }),
    mainPrisma.wallet.update({
      where: { id: recipientWallet.id },
      data: {
        points: { increment: gift.points },
        lifetimeEarn: { increment: gift.points },
      },
    }),
    mainPrisma.walletTransaction.create({
      data: {
        walletId: recipientWallet.id,
        points: gift.points,
        description: (() => {
          if (gift.message && gift.message.startsWith("{")) {
            try {
              const parsed = JSON.parse(gift.message);
              if (parsed.isGiftCard) {
                return `Claimed Gift Card (${parsed.theme || 'Special'}) from ${parsed.senderName || gift.sender.name || gift.sender.phone}${parsed.message ? ': ' + parsed.message : ''}`;
              }
            } catch (e) {}
          }
          return gift.message ? `Claimed gift from ${gift.sender.name || gift.sender.phone}: ${gift.message}` : `Claimed gift from ${gift.sender.name || gift.sender.phone}`;
        })(),
        tenantId: tenantId || null,
      },
    }),
  ]);

  return getWallet(db, userId);
};

// ─── claimAllGifts ─────────────────────────────────────────────────────────────

const claimAllGifts = async (db, tenantId, userId) => {
  const unclaimedGifts = await mainPrisma.gift.findMany({
    where: { recipientId: userId, claimed: false },
    include: { sender: true }
  });

  if (unclaimedGifts.length === 0) {
    return getWallet(db, userId);
  }

  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });

  if (!user || !user.wallet) throw new ApiError(404, "Wallet not found");

  const totalPoints = unclaimedGifts.reduce((sum, gift) => sum + gift.points, 0);

  const operations = [
    mainPrisma.gift.updateMany({
      where: {
        id: { in: unclaimedGifts.map(g => g.id) }
      },
      data: { claimed: true }
    }),
    mainPrisma.wallet.update({
      where: { id: user.wallet.id },
      data: {
        points: { increment: totalPoints },
        lifetimeEarn: { increment: totalPoints },
      }
    }),
    ...unclaimedGifts.map(gift => mainPrisma.walletTransaction.create({
      data: {
        walletId: user.wallet.id,
        points: gift.points,
        description: (() => {
          if (gift.message && gift.message.startsWith("{")) {
            try {
              const parsed = JSON.parse(gift.message);
              if (parsed.isGiftCard) {
                return `Claimed Gift Card (${parsed.theme || 'Special'}) from ${parsed.senderName || gift.sender.name || gift.sender.phone}${parsed.message ? ': ' + parsed.message : ''}`;
              }
            } catch (e) {}
          }
          return gift.message ? `Claimed gift from ${gift.sender.name || gift.sender.phone}: ${gift.message}` : `Claimed gift from ${gift.sender.name || gift.sender.phone}`;
        })(),
        tenantId: tenantId || null,
      }
    }))
  ];

  await mainPrisma.$transaction(operations);

  return getWallet(db, userId);
};

// ─── getLeaderboard ────────────────────────────────────────────────────────────
const getLeaderboard = async (db, sortBy = 'points') => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const AVATARS = [
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&h=100&fit=crop",
    "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=100&h=100&fit=crop"
  ];

  let rankedUsers = [];

  if (sortBy === 'orders') {
    // 1. Group completed orders in this month by user
    const orderGroups = await mainPrisma.order.groupBy({
      by: ['appUserId'],
      where: {
        appUserId: { not: null },
        createdAt: { gte: startOfMonth },
        status: 'COMPLETED',
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: 10,
    });

    const activeUserIds = orderGroups.map(g => g.appUserId);

    // 2. Fetch user information
    const users = await mainPrisma.appUser.findMany({
      where: { id: { in: activeUserIds } },
      include: { wallet: true },
    });

    rankedUsers = orderGroups.map(g => {
      const user = users.find(u => u.id === g.appUserId);
      return {
        id: g.appUserId,
        name: user?.name || user?.phone || "Loyal Customer",
        points: user?.wallet?.points || 0, // Fallback to overall points
        orders: g._count.id, // Monthly orders count
        avatar: user?.avatarUrl || null,
      };
    });
  } else {
    // sortBy === 'points'
    // 1. Group earned transactions in this month by wallet
    const transactionGroups = await mainPrisma.walletTransaction.groupBy({
      by: ['walletId'],
      where: {
        points: { gt: 0 },
        createdAt: { gte: startOfMonth },
      },
      _sum: {
        points: true,
      },
      orderBy: {
        _sum: {
          points: 'desc',
        },
      },
      take: 10,
    });

    const walletIds = transactionGroups.map(g => g.walletId);

    // 2. Fetch wallets and users
    const wallets = await mainPrisma.wallet.findMany({
      where: { id: { in: walletIds } },
      include: {
        appUser: {
          include: {
            _count: {
              select: { orders: { where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } } } }
            }
          }
        }
      },
    });

    rankedUsers = transactionGroups.map(g => {
      const wallet = wallets.find(w => w.id === g.walletId);
      const user = wallet?.appUser;
      return {
        id: user?.id || null,
        name: user?.name || user?.phone || "Loyal Customer",
        points: g._sum.points || 0, // Monthly points earned
        orders: user?._count?.orders || 0, // Monthly orders count
        avatar: user?.avatarUrl || null,
      };
    }).filter(item => item.id !== null);
  }

  // ── Fallback overall ranking if there is not enough monthly data ──
  if (rankedUsers.length < 10) {
    const existingIds = rankedUsers.map(u => u.id).filter(Boolean);
    
    let overallOrderBy = {
      wallet: {
        points: "desc"
      }
    };

    if (sortBy === 'orders') {
      overallOrderBy = {
        orders: {
          _count: "desc"
        }
      };
    }

    const remainingCount = 10 - rankedUsers.length;
    const fallbackUsers = await mainPrisma.appUser.findMany({
      where: {
        id: { notIn: existingIds },
      },
      take: remainingCount,
      include: {
        wallet: true,
        _count: {
          select: {
            orders: { where: { status: 'COMPLETED' } },
          }
        }
      },
      orderBy: overallOrderBy,
    });

    // Query monthly earned points for these fallback users to display consistent monthly values
    const fallbackUserWallets = fallbackUsers.map(u => u.wallet?.id).filter(Boolean);
    const fallbackMonthlyPoints = await mainPrisma.walletTransaction.groupBy({
      by: ['walletId'],
      where: {
        walletId: { in: fallbackUserWallets },
        points: { gt: 0 },
        createdAt: { gte: startOfMonth },
      },
      _sum: {
        points: true,
      }
    });

    const fallbackRanked = fallbackUsers.map(user => {
      const mPoints = fallbackMonthlyPoints.find(p => p.walletId === user.wallet?.id)?._sum?.points || 0;
      const points = mPoints > 0 ? mPoints : (user.wallet?.points || 0);
      const orders = user._count?.orders || 0;

      return {
        id: user.id,
        name: user.name || user.phone || "Loyal Customer",
        points,
        orders,
        avatar: user.avatarUrl || null,
      };
    });

    rankedUsers = [...rankedUsers, ...fallbackRanked];
  }

  // Map rank indices and fallback avatars
  return rankedUsers.map((user, index) => ({
    rank: index + 1,
    id: user.id,
    name: user.name,
    points: user.points,
    orders: user.orders,
    avatar: user.avatar || null,
  }));
};

// ─── getCoupons ───────────────────────────────────────────────────────────────
const getCoupons = async (db, userId) => {
  const coupons = await mainPrisma.earnedCoupon.findMany({
    where: { appUserId: userId },
    orderBy: { winDate: "desc" },
  });

  return coupons.map(c => ({
    id: c.id,
    couponCode: c.code,
    item: {
      label: c.prizeLabel,
      imageUrl: c.prizeImageUrl || null,
    },
    winDate: c.winDate,
    expiryDate: c.expiresAt,
    isUsed: c.isUsed,
  }));
};

// ─── addCoupon ────────────────────────────────────────────────────────────────
const addCoupon = async (db, userId, { prizeLabel, prizeImageUrl, code, expiresAt } = {}) => {
  const generatedCode = code || Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('');
  const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

  const coupon = await mainPrisma.earnedCoupon.create({
    data: {
      code: generatedCode,
      prizeLabel,
      prizeImageUrl: prizeImageUrl || null,
      expiresAt: expiry,
      appUserId: userId,
    },
  });

  return coupon;
};

const loyaltyService = require("../../web/tenant/loyalty/loyalty.service");

const lookupWalletByPhone = async (db, tenantId, phone) => {
  if (!phone) throw new ApiError(400, "Phone number is required");
  const cleanedPhone = normalisePhone(phone);

  const tenant = tenantId ? await mainPrisma.tenant.findUnique({ where: { id: tenantId } }) : null;
  const redeemRate = Number(tenant?.loyaltyRedeemRate || 100.0);
  const loyaltyEnabled = tenant ? tenant.loyaltyEnabled !== false : true;

  const appUser = await mainPrisma.appUser.findUnique({ where: { phone: cleanedPhone } });
  if (!appUser) {
    return {
      exists: false,
      points: 0,
      redeemRate,
      equivalentSar: 0,
      loyaltyEnabled,
      tier: {
        name: "Starter",
        level: 1,
        icon: "⭐",
        dailyCap: 0,
        dailyCapType: "blocked",
        redeemedToday: 0,
        remainingDailyCap: 0,
      },
    };
  }

  let wallet = await mainPrisma.wallet.findFirst({
    where: { appUserId: appUser.id, tenantId: tenantId || null },
  });

  if (!wallet && tenantId) {
    wallet = await mainPrisma.wallet.findFirst({
      where: { appUserId: appUser.id },
      orderBy: { createdAt: "asc" }
    });
  }

  if (!wallet) {
    wallet = { points: 0, lifetimeEarn: 0 };
  }

  const configuredTiers = tenant?.loyaltyTiers || [];
  const customerTier = loyaltyService.getCustomerTierDetails(appUser, wallet, configuredTiers);

  let redeemedToday = 0;
  if (wallet.id) {
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
    redeemedToday = Math.abs(todayRedeemTxs._sum.points || 0);
  }

  const dailyCap = Number(customerTier.dailyCap || 0);
  const remainingDailyCap = customerTier.dailyCapType === "unlimited"
    ? 999999
    : customerTier.dailyCapType === "blocked"
    ? 0
    : Math.max(0, dailyCap - redeemedToday);

  return {
    exists: true,
    appUserId: appUser.id,
    customerName: appUser.name,
    phone: appUser.phone,
    points: wallet.points || 0,
    redeemRate,
    equivalentSar: Number(((wallet.points || 0) / redeemRate).toFixed(2)),
    loyaltyEnabled,
    tier: {
      name: customerTier.name,
      level: customerTier.level,
      icon: customerTier.icon,
      dailyCap: customerTier.dailyCap,
      dailyCapType: customerTier.dailyCapType,
      redeemedToday,
      remainingDailyCap,
    },
  };
};

module.exports = {
  getWallet,
  getTransactions,
  transferPoints,
  sendGiftCard,
  verifyUser,
  getLeaderboard,
  getGifts,
  claimGift,
  claimAllGifts,
  getCoupons,
  addCoupon,
  lookupWalletByPhone,
};
