/**
 * App Brands Service
 */

const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");
const { formatProfile } = require("../profile/profile.service");
const { getAppImageURL } = require("../../config");

// Static brand asset details to keep database schema clean
const BRAND_DETAILS = {
  // Olive & Oak
  "1": {
    hero: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop",
    cuisine: "Mediterranean"
  },
  "olive-oak": {
    hero: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop",
    cuisine: "Mediterranean"
  },
  // Bolt Burgers
  "2": {
    hero: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop",
    cuisine: "American"
  },
  "bolt-burgers": {
    hero: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop",
    cuisine: "American"
  },
  // Matcha House
  "3": {
    hero: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=400&h=400&fit=crop",
    cuisine: "Café"
  },
  "matcha-house": {
    hero: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=400&h=400&fit=crop",
    cuisine: "Café"
  },
  // Dunes Grill
  "4": {
    hero: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop",
    cuisine: "Steakhouse"
  },
  "dunes-grill": {
    hero: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop",
    cuisine: "Steakhouse"
  },
  // Sakura Sushi
  "5": {
    hero: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&h=400&fit=crop",
    cuisine: "Sushi"
  },
  "sakura-sushi": {
    hero: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&h=400&fit=crop",
    cuisine: "Sushi"
  },
  // Casa Pizza
  "6": {
    hero: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&h=400&fit=crop",
    cuisine: "Pizza"
  },
  "casa-pizza": {
    hero: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&h=400&fit=crop",
    cuisine: "Pizza"
  }
};

const getBrands = async (userId) => {
  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId }
  });
  if (!user) throw new ApiError(404, "User not found");

  const favBrands = user.favoriteBrands || [];

  const tenants = await mainPrisma.tenant.findMany({
    where: {
      isActive: true,
      ordersEnabled: true
    }
  });

  return tenants.map(t => {
    // Map assets based on slug or ID, falling back to clean defaults
    const details = BRAND_DETAILS[t.slug] || BRAND_DETAILS[t.id] || {
      hero: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop",
      cuisine: "Restaurant"
    };

    return {
      id: t.id,
      name: t.name,
      logo: getAppImageURL(t.logoUrl) || "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=100&h=100&fit=crop",
      hero: getAppImageURL(t.menuBannerUrl) || details.hero,
      bannerUrl: getAppImageURL(t.bannerUrl),
      bannerUrl2: getAppImageURL(t.bannerUrl2),
      bannerUrl3: getAppImageURL(t.bannerUrl3),
      cuisine: details.cuisine,
      slug: t.slug,

      isFavorite: favBrands.includes(t.id) || favBrands.includes(t.slug),
      loyaltyEarnRate: Number(t.loyaltyEarnRate || 1.0),
      loyaltyRedeemRate: Number(t.loyaltyRedeemRate || 100.0)
    };
  });
};

const addFavorite = async (userId, brandId) => {
  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId }
  });
  if (!user) throw new ApiError(404, "User not found");

  const tenant = await mainPrisma.tenant.findFirst({
    where: {
      OR: [
        { id: brandId },
        { slug: brandId }
      ]
    }
  });
  if (!tenant) throw new ApiError(404, "Brand not found");

  let favBrands = Array.isArray(user.favoriteBrands) ? [...user.favoriteBrands] : [];
  if (!favBrands.includes(tenant.id)) {
    favBrands.push(tenant.id);
  }

  const updated = await mainPrisma.appUser.update({
    where: { id: userId },
    data: { favoriteBrands: favBrands },
    include: { wallet: true }
  });

  return formatProfile(updated);
};

const removeFavorite = async (userId, brandId) => {
  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId }
  });
  if (!user) throw new ApiError(404, "User not found");

  const tenant = await mainPrisma.tenant.findFirst({
    where: {
      OR: [
        { id: brandId },
        { slug: brandId }
      ]
    }
  });
  if (!tenant) throw new ApiError(404, "Brand not found");

  let favBrands = Array.isArray(user.favoriteBrands) ? [...user.favoriteBrands] : [];
  favBrands = favBrands.filter(id => id !== tenant.id && id !== tenant.slug);

  const updated = await mainPrisma.appUser.update({
    where: { id: userId },
    data: { favoriteBrands: favBrands },
    include: { wallet: true }
  });

  return formatProfile(updated);
};

module.exports = {
  getBrands,
  addFavorite,
  removeFavorite
};
