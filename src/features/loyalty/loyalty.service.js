const ApiError = require("../../utils/ApiError");
const { syncToAggregatedCustomer } = require("../customers/customers.service");

const getWallet = async (db, userId) => {
  const wallet = await db.wallet.findUnique({
    where: { userId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!wallet) throw new ApiError(404, "Wallet not found");
  return wallet;
 };
 
 /**
  * Award points to a user (e.g. after order completion).
  */
 const earnPoints = async (db, userId, points, description, tenantId) => {
   const wallet = await db.wallet.findUnique({ where: { userId } });
   if (!wallet) throw new ApiError(404, "Wallet not found");
 
   const [updatedWallet] = await db.$transaction([
     db.wallet.update({
       where: { userId },
       data: { points: { increment: points }, lifetimeEarn: { increment: points } },
     }),
     db.walletTransaction.create({
       data: { walletId: wallet.id, points, description: description || "Points earned" },
     }),
   ]);
 
   if (tenantId) {
     syncToAggregatedCustomer(db, tenantId, userId).catch(console.error);
   }

   return updatedWallet;
 };
 
 /**
  * Redeem points from a user's wallet.
  */
 const redeemPoints = async (db, userId, points, description, tenantId) => {
   const wallet = await db.wallet.findUnique({ where: { userId } });
   if (!wallet) throw new ApiError(404, "Wallet not found");
   if (wallet.points < points) throw new ApiError(400, "Insufficient points");
 
   const [updatedWallet] = await db.$transaction([
     db.wallet.update({
       where: { userId },
       data: { points: { decrement: points } },
     }),
     db.walletTransaction.create({
       data: { walletId: wallet.id, points: -points, description: description || "Points redeemed" },
     }),
   ]);
 
   if (tenantId) {
     syncToAggregatedCustomer(db, tenantId, userId).catch(console.error);
   }

   return updatedWallet;
 };

const searchCustomers = async (db, search) => {
  const query = search ? search.trim() : "";
  if (!query) return [];

  // 1. Search locally
  const localCustomers = await db.user.findMany({
    where: {
      role: "CUSTOMER",
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    include: {
      wallet: true,
    },
    take: 10,
  });

  // 2. Search globally in aggregated customer registry
  const mainPrisma = require("../../config/prisma");
  const globalMatches = await mainPrisma.aggregatedCustomer.findMany({
    where: {
      OR: [
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 10,
  });

  // 3. Auto-import/sync global customers that aren't present locally or need updating
  for (const match of globalMatches) {
    if (!match.phone && !match.email) continue;

    // Check if customer is already returned in local search results
    const alreadyLocal = localCustomers.some(
      (lc) => (match.phone && lc.phone === match.phone) || (match.email && lc.email === match.email)
    );
    if (alreadyLocal) continue;

    // Double check database if they exist but were missed by containing query match
    const existingLocalUser = await db.user.findFirst({
      where: {
        OR: [
          match.phone ? { phone: match.phone } : null,
          match.email ? { email: match.email } : null,
        ].filter(Boolean),
      },
      include: { wallet: true },
    });

    if (existingLocalUser) {
      if (existingLocalUser.wallet && existingLocalUser.wallet.points !== match.points) {
        await db.wallet.update({
          where: { id: existingLocalUser.wallet.id },
          data: { points: match.points }
        });
        existingLocalUser.wallet.points = match.points;
      }
      localCustomers.push(existingLocalUser);
    } else {
      // Auto-import global customer to the local tenant DB
      try {
        const newUser = await db.user.create({
          data: {
            name: match.name || "Walk-in Customer",
            phone: match.phone,
            email: match.email,
            role: "CUSTOMER",
          },
        });
        const newWallet = await db.wallet.create({
          data: {
            userId: newUser.id,
            points: match.points,
            lifetimeEarn: match.points,
          },
        });
        localCustomers.push({
          ...newUser,
          wallet: newWallet,
        });
      } catch (err) {
        console.error("Failed to auto-import global customer on lookup:", err.message);
      }
    }
  }

  return localCustomers.map((u) => ({
    id: u.id,
    name: u.name || "Unnamed",
    phone: u.phone,
    email: u.email,
    points: u.wallet?.points || 0,
  }));
};

const getAllCustomersForReport = async (db) => {
  const customers = await db.user.findMany({
    where: { role: "CUSTOMER" },
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
  const transactions = await db.walletTransaction.findMany({
    include: {
      wallet: {
        include: {
          user: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return transactions.map((t) => ({
    id: t.id,
    customerName: t.wallet?.user?.name || "Unnamed",
    customerPhone: t.wallet?.user?.phone || "",
    points: t.points,
    description: t.description,
    createdAt: t.createdAt,
  }));
};

module.exports = { 
  getWallet, 
  earnPoints, 
  redeemPoints, 
  searchCustomers, 
  getAllCustomersForReport, 
  getAllTransactionsForReport 
};
