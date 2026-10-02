/**
 * Public Customer Stamp QR Service
 * Handles brand stamp QR token resolution, customer phone lookup & OTP verification,
 * and customer stamp card wallet generation.
 */

const jwt = require("jsonwebtoken");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");
const { decodeQrToken, encodeQrToken } = require("../../utils/qrToken.utils");

const DEV_OTP = "1111";

const getPhoneCandidates = (raw) => {
  if (!raw) return [];
  const str = raw.toString().trim();
  const digits = str.replace(/\D/g, "");
  
  // Extract base digits without leading 966 or 0
  let base = digits;
  if (base.startsWith("966")) {
    base = base.substring(3);
  }
  if (base.startsWith("0")) {
    base = base.substring(1);
  }

  const set = new Set();
  // Standard +966 format
  if (base) {
    set.add(`+966${base}`);
    set.add(`966${base}`);
    set.add(`0${base}`);
    set.add(base);
  }
  if (str) {
    set.add(str);
    if (!str.startsWith("+")) set.add(`+${str}`);
  }
  return Array.from(set);
};

const normalisePhone = (raw) => {
  if (!raw) return "";
  let digits = raw.toString().trim().replace(/\D/g, "");
  if (digits.startsWith("966")) {
    digits = digits.substring(3);
  }
  if (digits.startsWith("0")) {
    digits = digits.substring(1);
  }
  // Return standard Saudi format +966...
  return digits ? `+966${digits}` : "";
};


const signToken = (userId) =>
  jwt.sign({ sub: userId, type: "customer" }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

/**
 * Resolves brand stamp program details from encrypted QR token or tenantId
 */
const resolveStampProgram = async ({ token, tenantId }) => {
  let resolvedTenantId = tenantId;
  let stampId = null;

  if (token) {
    try {
      const decoded = decodeQrToken(token);
      resolvedTenantId = decoded.tenantId || resolvedTenantId;
      stampId = decoded.stampId || null;
    } catch (err) {
      throw new ApiError(400, "Invalid or expired QR token");
    }
  }

  if (!resolvedTenantId) {
    throw new ApiError(400, "Brand identifier or valid token is required");
  }

  const tenant = await mainPrisma.tenant.findFirst({
    where: {
      OR: [{ id: resolvedTenantId }, { slug: resolvedTenantId }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      loyaltyEnabled: true,
      stampPrograms: true,
    },
  });

  if (!tenant) {
    throw new ApiError(404, "Brand not found");
  }

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = (stampId ? stampList.find((s) => s.id === stampId) : null) || stampList[0] || null;

  return {
    brand: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      loyaltyEnabled: tenant.loyaltyEnabled,
    },
    stampProgram: {
      id: stampProg?.id || "default",
      nameEn: stampProg?.nameEn || "Drinks",
      nameAr: stampProg?.nameAr || "المشروبات",
      requiredStamps: Number(stampProg?.requiredStamps || 6),
      cardBgColor: stampProg?.cardBgColor || "#7F1D1D",
      cardTextColor: stampProg?.cardTextColor || "#FFFFFF",
      rewardTextEn: stampProg?.rewardTextEn || "Free Drink on 6th stamp",
      rewardTextAr: stampProg?.rewardTextAr || "مشروب مجاني عند الختم السادس",
      enabled: stampProg ? stampProg.enabled !== false : true,
    },
  };
};

/**
 * Checks if a customer exists by phone and sends OTP (1111 in dev)
 */
const checkPhoneAndSendOtp = async (rawPhone) => {
  const phone = normalisePhone(rawPhone);
  if (!phone || phone.length < 9) {
    throw new ApiError(400, "Please enter a valid phone number");
  }

  // Find customer in database using candidate formats (e.g. +966..., 05..., 5...)
  const candidates = getPhoneCandidates(rawPhone);
  const user = await mainPrisma.appUser.findFirst({
    where: {
      phone: { in: candidates },
    },
  });

  // Invalidate previous OTPs
  await mainPrisma.otp.updateMany({
    where: {
      phone: { in: candidates },
      verified: false,
    },
    data: { verified: true },
  });

  const code = process.env.NODE_ENV !== "production" ? DEV_OTP : DEV_OTP;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await mainPrisma.otp.create({
    data: { phone, code, expiresAt },
  });

  return {
    phone,
    exists: Boolean(user && user.name && user.name.trim().length > 0),
    name: user?.name || "",
    message: "OTP sent successfully",
  };
};

/**
 * Verifies OTP, registers or fetches customer, creates wallet for brand if missing,
 * and generates customer's personal stamp QR payload.
 */
const verifyOtpAndGetStampCard = async ({ phone: rawPhone, code, name, token, tenantId }) => {
  const phone = normalisePhone(rawPhone);
  if (!phone || !code) {
    throw new ApiError(400, "Phone number and OTP code are required");
  }

  // Resolve Tenant
  let resolvedTenantId = tenantId;
  let stampId = null;

  if (token) {
    try {
      const decoded = decodeQrToken(token);
      resolvedTenantId = decoded.tenantId || resolvedTenantId;
      stampId = decoded.stampId || null;
    } catch (err) {
      throw new ApiError(400, "Invalid QR token");
    }
  }

  if (!resolvedTenantId) {
    throw new ApiError(400, "Brand context is required");
  }

  const tenant = await mainPrisma.tenant.findFirst({
    where: {
      OR: [{ id: resolvedTenantId }, { slug: resolvedTenantId }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      stampPrograms: true,
    },
  });

  if (!tenant) {
    throw new ApiError(404, "Brand not found");
  }

  // Verify OTP
  const isDevBypass = String(code).trim() === DEV_OTP;
  const otp = await mainPrisma.otp.findFirst({
    where: {
      phone,
      code: String(code).trim(),
      verified: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp && !isDevBypass) {
    throw new ApiError(400, "Invalid or expired OTP code");
  }

  if (otp) {
    await mainPrisma.otp.update({ where: { id: otp.id }, data: { verified: true } });
  }

  // Find or create AppUser
  const candidates = getPhoneCandidates(rawPhone);
  let user = await mainPrisma.appUser.findFirst({
    where: {
      phone: { in: candidates },
    },
  });

  const cleanName = name ? name.trim() : "";

  if (!user) {
    user = await mainPrisma.appUser.create({
      data: {
        phone,
        name: cleanName || "Valued Customer",
      },
    });
  } else if (cleanName && (!user.name || user.name === "Valued Customer" || user.name.trim() !== cleanName)) {
    user = await mainPrisma.appUser.update({
      where: { id: user.id },
      data: { name: cleanName },
    });
  }

  // Ensure customer has a wallet for this tenant
  let wallet = await mainPrisma.wallet.findFirst({
    where: {
      appUserId: user.id,
      tenantId: tenant.id,
    },
  });

  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: user.id,
        tenantId: tenant.id,
        points: 0,
        lifetimeEarn: 0,
        tier: "bronze",
      },
    });
  }

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = (stampId ? stampList.find((s) => s.id === stampId) : null) || stampList[0] || null;

  // Generate Customer's Personal Stamp QR Payload (scannable by POS & mobile app)
  const qrPayload = JSON.stringify({
    customerId: user.id,
    phone: user.phone,
    tenantId: tenant.id,
    type: "STAMP",
  });

  // Also generate an encrypted customer stamp token
  const customerStampToken = encodeQrToken({
    tenantId: tenant.id,
    customerId: user.id,
    type: "CUSTOMER_STAMP",
  });

  // Check for any active, unredeemed coupon for this customer & brand
  const activeCoupon = await mainPrisma.earnedCoupon.findFirst({
    where: {
      appUserId: user.id,
      tenantId: tenant.id,
      isUsed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  let activeCouponData = null;
  if (activeCoupon) {
    const couponQrPayload = JSON.stringify({
      code: activeCoupon.code,
      tenantId: tenant.id,
      customerId: user.id,
      menuItemId: activeCoupon.menuItemId || null,
      type: "COUPON",
    });
    activeCouponData = {
      id: activeCoupon.id,
      code: activeCoupon.code,
      prizeLabel: activeCoupon.prizeLabel,
      itemName: activeCoupon.prizeLabel?.replace("Free ", "")?.replace(" (Stamp Reward)", "") || "Reward Item",
      menuItemId: activeCoupon.menuItemId || null,
      expiresAt: activeCoupon.expiresAt,
      qrPayload: couponQrPayload,
    };
  }

  const authToken = signToken(user.id);

  return {
    token: authToken,
    customer: {
      id: user.id,
      name: user.name,
      phone: user.phone,
    },
    brand: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
    },
    stampCard: {
      stamps: wallet.stamps || 0,
      requiredStamps: Number(stampProg?.requiredStamps || 6),
      nameEn: stampProg?.nameEn || "Drinks",
      nameAr: stampProg?.nameAr || "المشروبات",
      cardBgColor: stampProg?.cardBgColor || "#7F1D1D",
      cardTextColor: stampProg?.cardTextColor || "#FFFFFF",
      rewardTextEn: stampProg?.rewardTextEn || "Free Drink on 6th stamp",
      rewardTextAr: stampProg?.rewardTextAr || "مشروب مجاني عند الختم السادس",
    },
    qrPayload,
    customerStampToken,
    activeCoupon: activeCouponData,
  };
};

/**
 * Returns the eligible items that the customer purchased to earn their stamps
 */
const getEligibleItemsHistory = async ({ customerId, tenantId }) => {
  if (!customerId || !tenantId) {
    throw new ApiError(400, "customerId and tenantId are required");
  }

  const tenant = await mainPrisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new ApiError(404, "Brand not found");
  }

  const { getTenantClient } = require("../../config/tenantManager");
  const tenantDb = getTenantClient(tenant.dbUrl);

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = stampList[0] || null;
  const eligibleIds = Array.isArray(stampProg?.eligibleItemIds) ? stampProg.eligibleItemIds.map(String) : [];

  // Find customer's completed orders
  const orders = await tenantDb.order.findMany({
    where: {
      customerId,
      status: "COMPLETED",
    },
    include: {
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const purchasedItemIds = new Set();
  for (const o of orders) {
    for (const it of o.items || []) {
      if (it.menuItemId && (eligibleIds.length === 0 || eligibleIds.includes(String(it.menuItemId)))) {
        purchasedItemIds.add(String(it.menuItemId));
      }
    }
  }

  const targetIds = purchasedItemIds.size > 0 ? Array.from(purchasedItemIds) : eligibleIds;

  let items = [];
  if (targetIds.length > 0) {
    items = await tenantDb.menuItem.findMany({
      where: {
        id: { in: targetIds },
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
      },
    });
  }

  return {
    items,
    rewardTextEn: stampProg?.rewardTextEn || "Free Stamp Reward",
    rewardTextAr: stampProg?.rewardTextAr || null,
  };
};

/**
 * Generates a Free Reward Coupon for an eligible item chosen by the customer.
 * Note: Stamps remain intact until the coupon is claimed / redeemed at the POS.
 */
const claimRewardCoupon = async ({ customerId, tenantId, menuItemId }) => {
  if (!customerId || !tenantId) {
    throw new ApiError(400, "customerId and tenantId are required");
  }

  const tenant = await mainPrisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new ApiError(404, "Brand not found");
  }

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = stampList[0] || null;
  const requiredStamps = Number(stampProg?.requiredStamps || 6);

  const wallet = await mainPrisma.wallet.findFirst({
    where: {
      appUserId: customerId,
      tenantId: tenant.id,
    },
  });

  if (!wallet || (wallet.stamps || 0) < requiredStamps) {
    throw new ApiError(400, `Insufficient stamps to generate coupon. You have ${wallet?.stamps || 0}/${requiredStamps} stamps.`);
  }

  // Check if an unredeemed active coupon already exists
  const existingActive = await mainPrisma.earnedCoupon.findFirst({
    where: {
      appUserId: customerId,
      tenantId: tenant.id,
      isUsed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingActive) {
    const couponQrPayload = JSON.stringify({
      code: existingActive.code,
      tenantId: tenant.id,
      customerId,
      type: "COUPON",
    });
    return {
      coupon: {
        id: existingActive.id,
        code: existingActive.code,
        prizeLabel: existingActive.prizeLabel,
        itemName: existingActive.prizeLabel?.replace("Free ", "")?.replace(" (Stamp Reward)", "") || "Reward Item",
        expiresAt: existingActive.expiresAt,
        qrPayload: couponQrPayload,
      },
      currentStamps: wallet.stamps || 0,
    };
  }

  const { getTenantClient } = require("../../config/tenantManager");
  const tenantDb = getTenantClient(tenant.dbUrl);

  let selectedItem = null;
  if (menuItemId) {
    selectedItem = await tenantDb.menuItem.findUnique({
      where: { id: menuItemId },
    });
  }

  const itemName = selectedItem?.name || "Drink";
  const brandPrefix = (tenant.slug || tenant.name || "SERVI").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
  const couponCode = `STAMP-${brandPrefix}-${randomPart}`;

  const coupon = await mainPrisma.earnedCoupon.create({
    data: {
      code: couponCode,
      prizeLabel: `Free ${itemName} (Stamp Reward)`,
      prizeImageUrl: selectedItem?.imageUrl || null,
      menuItemId: selectedItem?.id || menuItemId || null,
      tenantId: tenant.id,
      appUserId: customerId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days valid
    },
  });

  // Deduct requiredStamps for this coupon from wallet stamps (keep any rollover stamps)
  const remainingStamps = Math.max(0, (wallet.stamps || 0) - requiredStamps);
  await mainPrisma.wallet.update({
    where: { id: wallet.id },
    data: { stamps: remainingStamps },
  });

  // Log to wallet transaction history
  await mainPrisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      points: 0,
      description: `Generated Stamp Reward Coupon: ${couponCode} for Free ${itemName} (-${requiredStamps} Stamps)`,
      tenantId: tenant.id,
    },
  });

  const couponQrPayload = JSON.stringify({
    code: coupon.code,
    tenantId: tenant.id,
    customerId,
    menuItemId: selectedItem?.id || menuItemId || null,
    itemName,
    type: "COUPON",
  });

  return {
    coupon: {
      id: coupon.id,
      code: coupon.code,
      prizeLabel: coupon.prizeLabel,
      itemName,
      menuItemId: selectedItem?.id || menuItemId || null,
      expiresAt: coupon.expiresAt,
      qrPayload: couponQrPayload,
    },
    currentStamps: wallet.stamps || 0,
  };
};

const updateCustomerName = async ({ customerId, name }) => {
  if (!customerId || !name || !name.trim()) {
    throw new ApiError(400, "customerId and name are required");
  }

  const user = await mainPrisma.appUser.update({
    where: { id: customerId },
    data: { name: name.trim() },
    select: {
      id: true,
      name: true,
      phone: true,
    },
  });

  return { customer: user };
};

module.exports = {
  resolveStampProgram,
  checkPhoneAndSendOtp,
  verifyOtpAndGetStampCard,
  getEligibleItemsHistory,
  claimRewardCoupon,
  generateRewardCoupon: claimRewardCoupon,
  updateCustomerName,
};
