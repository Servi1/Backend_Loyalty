/**
 * App Profile Service
 *
 * updateProfile — update name, email, avatarUrl
 * deleteAccount — soft-delete / anonymise customer (GDPR-ready stub)
 */

const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");
const { getAppImageURL } = require("../../config");

// ─── Update profile ───────────────────────────────────────────────────────────

const updateProfile = async (db, userId, { name, email, avatarUrl, cars, addresses, paymentMethods, favoriteBrands, lastName, gender, dob }, tenantId) => {
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
      ...(lastName !== undefined && { lastName }),
      ...(gender !== undefined && { gender }),
      ...(dob !== undefined && { dob: dob ? new Date(dob) : null }),
    },
    include: { wallet: true },
  });

  const ordersCount = db
    ? await db.order.count({
        where: { customerId: userId },
      })
    : 0;

  let totalSpent = 0.0;
  if (db) {
    const totalSpentResult = await db.order.aggregate({
      where: {
        customerId: userId,
        status: "COMPLETED",
      },
      _sum: {
        total: true,
      },
    });
    totalSpent = totalSpentResult._sum.total || 0.0;
  }

  return {
    ...(await _formatProfile(updated)),
    ordersCount,
    totalSpent,
  };
};

// ─── Delete / anonymise account ───────────────────────────────────────────────

const deleteAccount = async (db, userId) => {
  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId },
    include: { wallet: true }
  });
  if (!user) throw new ApiError(404, "User not found");

  // Soft-delete: clear all personal details but keep phone so they can be blocked on future logins
  await mainPrisma.appUser.update({
    where: { id: userId },
    data: {
      isDelete: true,
      name: "Deleted User",
      lastName: null,
      email: null,
      gender: null,
      dob: null,
      avatarUrl: null,
      cars: [],
      addresses: [],
      paymentMethods: [],
      favoriteBrands: [],
    },
  });

  // Reset loyalty points
  if (user.wallet) {
    await mainPrisma.wallet.update({
      where: { id: user.wallet.id },
      data: {
        points: 0,
        lifetimeEarn: 0,
      },
    });
  }

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
      bannerUrl: true,
      bannerUrl2: true,
      bannerUrl3: true,
      menuBannerUrl: true,
      primaryColor: true,
      accentColor: true,
    }
  });

  return tenants.map(t => ({
    id: t.id,
    name: t.name,
    logo: getAppImageURL(t.logoUrl) || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=100&h=100&fit=crop',
    hero: getAppImageURL(t.menuBannerUrl) || 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop',
    bannerUrl: getAppImageURL(t.bannerUrl),
    bannerUrl2: getAppImageURL(t.bannerUrl2),
    bannerUrl3: getAppImageURL(t.bannerUrl3),
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
    lastName: user.lastName,
    phone: user.phone,
    email: user.email,
    gender: user.gender,
    dob: user.dob,
    avatarUrl: getAppImageURL(user.avatarUrl),
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
