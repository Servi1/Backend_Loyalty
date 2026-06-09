/**
 * App Profile Service
 *
 * updateProfile — update name, email, avatarUrl
 * deleteAccount — soft-delete / anonymise customer (GDPR-ready stub)
 */

const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");

// ─── Update profile ───────────────────────────────────────────────────────────

const updateProfile = async (db, userId, { name, email, avatarUrl, cars, addresses, paymentMethods, favoriteBrands }, tenantId) => {
  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });
  if (!user) throw new ApiError(404, "User not found");

  // Email uniqueness check (if changing)
  if (email && email !== user.email) {
    const exists = await mainPrisma.appUser.findUnique({ where: { email } });
    if (exists) throw new ApiError(409, "That email is already in use");
  }

  const updated = await mainPrisma.appUser.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(cars !== undefined && { cars }),
      ...(addresses !== undefined && { addresses }),
      ...(paymentMethods !== undefined && { paymentMethods }),
      ...(favoriteBrands !== undefined && { favoriteBrands }),
    },
    include: { wallet: true },
  });

  const ordersCount = await db.order.count({
    where: { customerId: userId },
  });

  const totalSpentResult = await db.order.aggregate({
    where: {
      customerId: userId,
      status: "COMPLETED",
    },
    _sum: {
      total: true,
    },
  });
  const totalSpent = totalSpentResult._sum.total || 0.0;

  return {
    ...(await _formatProfile(updated)),
    ordersCount,
    totalSpent,
  };
};

// ─── Delete / anonymise account ───────────────────────────────────────────────

const deleteAccount = async (db, userId) => {
  const user = await mainPrisma.appUser.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");

  // Anonymise instead of hard-delete — preserves order history integrity
  await mainPrisma.appUser.update({
    where: { id: userId },
    data: {
      name: "Deleted User",
      phone: null,
      email: null,
      avatarUrl: null,
    },
  });

  return { message: "Account deleted successfully" };
};

// ─── Private helpers ──────────────────────────────────────────────────────────

const getFavoriteBrandsDetails = async (brandIds) => {
  if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
    return [];
  }
  const tenants = await mainPrisma.tenant.findMany({
    where: {
      OR: [
        { id: { in: brandIds } },
        { slug: { in: brandIds } }
      ]
    },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      primaryColor: true,
      accentColor: true,
    }
  });

  return tenants.map(t => ({
    id: t.id,
    name: t.name,
    logo: t.logoUrl || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=100&h=100&fit=crop',
    hero: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop',
    slug: t.slug,
    isFavorite: true,
    cuisine: 'Restaurant',
  }));
};

const _formatProfile = async (user) => {
  const favoriteBrandsDetails = await getFavoriteBrandsDetails(user.favoriteBrands || []);
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: "CUSTOMER",
    cars: user.cars || [],
    addresses: user.addresses || [],
    paymentMethods: user.paymentMethods || [],
    favoriteBrands: user.favoriteBrands || [],
    favoriteBrandsDetails,
    wallet: user.wallet
      ? { points: user.wallet.points, lifetimeEarn: user.wallet.lifetimeEarn }
      : null,
    createdAt: user.createdAt,
  };
};

module.exports = { updateProfile, deleteAccount, formatProfile: _formatProfile };
