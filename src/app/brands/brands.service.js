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

  let disabledList = [];
  try {
    const disabledSetting = await mainPrisma.systemSetting.findUnique({
      where: { key: "disabledCategories" }
    });
    if (disabledSetting && disabledSetting.value) {
      disabledList = disabledSetting.value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    }
  } catch (err) {}

  const [tenants, allCategories] = await Promise.all([
    mainPrisma.tenant.findMany({
      where: {
        isActive: true,
        ordersEnabled: true
      }
    }),
    mainPrisma.tenantCategory.findMany({
      select: { name: true }
    })
  ]);

  const activeTenantCategories = allCategories.filter(c => !disabledList.includes(c.name.toLowerCase().trim()));

  const validCategoryMap = new Map();
  activeTenantCategories.forEach(c => {
    validCategoryMap.set(c.name.toLowerCase().trim(), c.name);
  });

  return tenants.map(t => {
    // Map assets based on slug or ID, falling back to clean defaults
    const details = BRAND_DETAILS[t.slug] || BRAND_DETAILS[t.id] || {
      hero: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop",
      cuisine: "Restaurant"
    };

    let resolvedCategory = null;
    if (t.category) {
      const lowerCat = t.category.toLowerCase().trim();
      if (validCategoryMap.has(lowerCat)) {
        resolvedCategory = validCategoryMap.get(lowerCat);
      } else {
        // Dynamically resolve if category was renamed (e.g. prefix match)
        const matched = activeTenantCategories.find(c => {
          const cLower = c.name.toLowerCase().trim();
          return cLower.startsWith(lowerCat) || lowerCat.startsWith(cLower);
        });
        if (matched) {
          resolvedCategory = matched.name;
          mainPrisma.tenant.update({
            where: { id: t.id },
            data: { category: matched.name }
          }).catch(() => {});
        }
      }
    }

    const stampProgramsList = Array.isArray(t.stampPrograms) ? t.stampPrograms : [];
    const isStampEnabled = Boolean(t.subStamps) && stampProgramsList.some(s => s && s.enabled !== false);

    return {
      id: t.id,
      name: t.name,
      nameAr: t.nameAr || null,
      logo: getAppImageURL(t.logoUrl) || "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=100&h=100&fit=crop",
      hero: getAppImageURL(t.menuBannerUrl) || details.hero,
      bannerUrl: getAppImageURL(t.bannerUrl),
      bannerUrl2: getAppImageURL(t.bannerUrl2),
      bannerUrl3: getAppImageURL(t.bannerUrl3),
      cuisine: details.cuisine,
      category: resolvedCategory || (t.category && validCategoryMap.size === 0 ? t.category : null),
      slug: t.slug,

      isFavorite: favBrands.includes(t.id) || favBrands.includes(t.slug),
      loyaltyEarnRate: Boolean(t.subLoyalty && t.loyaltyEnabled && t.loyaltyAddPoints !== false) ? Number(t.loyaltyEarnRate !== undefined && t.loyaltyEarnRate !== null ? t.loyaltyEarnRate : 1.0) : 0.0,
      loyaltyRedeemRate: Number(t.loyaltyRedeemRate || 100.0),
      subBrandStory: Boolean(t.subBrandStory),
      loyaltyRedeemPoints: Boolean(t.subLoyalty && t.loyaltyEnabled && t.loyaltyRedeemPoints !== false),
      loyaltyAddPoints: Boolean(t.subLoyalty && t.loyaltyEnabled && t.loyaltyAddPoints !== false),
      loyaltyPointsEnabled: Boolean(t.subLoyalty && t.loyaltyEnabled),
      loyaltyEnabled: Boolean(t.subLoyalty && t.loyaltyEnabled),
      stampEnabled: isStampEnabled,
      stampsEnabled: isStampEnabled,
      loyaltyStamps: isStampEnabled,
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
    include: { wallets: true }
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
    include: { wallets: true }
  });

  return formatProfile(updated);
};

module.exports = {
  getBrands,
  addFavorite,
  removeFavorite
};
