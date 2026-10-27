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
const { sendOtpSms } = require("../../services/oursms.service");
const { generateRandomOtp, isDevOtpBypass, isDevBypassEnabled, getDevOtpBypassCode } = require("../../utils/otp");

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
      loyaltyEnabled: Boolean(tenant.subLoyalty && tenant.loyaltyEnabled),
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

  // Generate real numeric 4-digit code
  const code = generateRandomOtp(4);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await mainPrisma.otp.create({
    data: { phone, code, expiresAt },
  });

  // Dispatch real SMS via OurSMS
  await sendOtpSms(rawPhone, code);

  const devBypassAllowed = isDevBypassEnabled();

  return {
    phone,
    exists: Boolean(user && user.name && user.name.trim().length > 0),
    name: user?.name || "",
    message: "OTP sent successfully",
    devBypass: devBypassAllowed,
  };
};

/**
 * Verifies OTP, registers or fetches customer, creates wallet for brand if missing,
 * and generates customer's personal stamp QR payload.
 */
/**
 * Calculates and synchronizes customer earned stamps from completed orders
 * across the tenant's database, taking into account any generated coupons.
 */
const syncCustomerStamps = async (user, tenant, stampProg = null) => {
  const activeProg = stampProg || (Array.isArray(tenant?.stampPrograms) ? tenant.stampPrograms[0] : null);
  if (!user || !tenant || !activeProg) {
    return { stamps: 0, wallet: null };
  }

  const requiredStamps = Number(activeProg.requiredStamps || 6);
  const eligibleIds = Array.isArray(activeProg.eligibleItemIds)
    ? activeProg.eligibleItemIds.map(String).filter(Boolean)
    : [];
  const eligibleNames = Array.isArray(activeProg.eligibleItemNames)
    ? activeProg.eligibleItemNames.map((n) => String(n).toLowerCase().trim()).filter(Boolean)
    : [];

  // Get current wallet if it exists
  let wallet = await mainPrisma.wallet.findFirst({
    where: {
      appUserId: user.id,
      tenantId: tenant.id,
    },
  });

  // Timeline of events (manual adjustments, orders, coupons)
  const events = [];

  // 1. Load manual stamp adjustments from main DB
  if (wallet) {
    try {
      const stampTransactions = await mainPrisma.walletTransaction.findMany({
        where: {
          walletId: wallet.id,
          points: 0,
          OR: [
            { description: { contains: "STAMP" } },
            { description: { contains: "stamp", mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });

      stampTransactions.forEach((tx) => {
        const desc = tx.description || "";
        const matchMeta = desc.match(/\[STAMP_ADJUST:(?:mode=([^:]+):)?delta=([-\d]+)(?::total=([-\d]+))?\]/);
        if (matchMeta) {
          const adjMode = matchMeta[1] || "";
          const delta = parseInt(matchMeta[2], 10) || 0;
          const total = matchMeta[3] !== undefined ? parseInt(matchMeta[3], 10) : null;
          events.push({
            type: "stamp_adjust",
            date: new Date(tx.createdAt),
            mode: adjMode,
            delta,
            total,
          });
        } else {
          // Fallback regex for legacy transactions: "Stamps adjusted (+X stamps)" or "(-X stamps)"
          const legacyMatch = desc.match(/Stamps adjusted \(([+-]?\d+)\s*stamps?\)/i);
          if (legacyMatch) {
            const delta = parseInt(legacyMatch[1], 10) || 0;
            events.push({
              type: "stamp_adjust",
              date: new Date(tx.createdAt),
              mode: delta < 0 ? "deduct" : "add",
              delta,
              total: null,
            });
          }
        }
      });
    } catch (txErr) {
      console.error("[STAMPS] Error loading stamp adjustments:", txErr.message);
    }
  }

  // 2. Load completed orders from tenant DB
  if (tenant.dbUrl) {
    try {
      const { getTenantClient } = require("../../config/tenantManager");
      const tenantDb = getTenantClient(tenant.dbUrl);

      const phoneCandidates = getPhoneCandidates(user.phone);
      const OR = [
        { customerId: user.id },
        { userId: user.id },
      ];
      if (phoneCandidates.length > 0) {
        OR.push({ customerPhone: { in: phoneCandidates } });
      }

      // Also backfill customerId on anonymous orders if matching phone
      try {
        if (phoneCandidates.length > 0) {
          await tenantDb.order.updateMany({
            where: {
              customerPhone: { in: phoneCandidates },
              customerId: null,
            },
            data: {
              customerId: user.id,
            },
          });
        }
      } catch (err) {
        // Non-critical backfill
      }

      const completedOrders = await tenantDb.order.findMany({
        where: {
          OR,
          status: "COMPLETED",
        },
        include: {
          items: {
            include: {
              menuItem: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const { isOrderEligibleForLoyalty } = require("../../shared/loyalty/loyaltyEligibility");

      for (const o of completedOrders) {
        // Skip coupon claim orders or free reward orders
        const oPm = (o.paymentMethod || "").toLowerCase();
        const oNotes = o.notes || "";
        if (
          oPm === "coupon" ||
          oPm === "free_reward" ||
          oNotes.includes("Free Stamp Reward") ||
          oNotes.includes("Stamp Reward Coupon") ||
          oNotes.includes("[STAMPS_ELIGIBLE:false]")
        ) {
          console.log(`[STAMPS SYNC] Order #${o.orderNumber} is a reward coupon claim order. Skipping stamps.`);
          continue;
        }

        // Real-time check: was stamps enabled at the exact moment this order was placed?
        const isEligible = await isOrderEligibleForLoyalty(o, tenant.id, "STAMPS", tenant);
        if (!isEligible) {
          console.log(`[STAMPS SYNC] Order #${o.orderNumber} placed at ${o.createdAt} was placed when stamps was disabled. Skipping stamps.`);
          continue;
        }

        let orderStamps = 0;
        if (Array.isArray(o.items)) {
          o.items.forEach((it) => {
            // Do not award stamps for free reward items (price 0)
            if (Number(it.price || 0) === 0) return;
            const mId = String(it.menuItemId || it.itemId || it.id || "");
            const itName = String(it.name || it.menuItem?.name || "").toLowerCase().trim();
            const matchesId = eligibleIds.length === 0 || (mId && eligibleIds.includes(mId));
            const matchesName = eligibleNames.length > 0 && itName && eligibleNames.some((en) => itName.includes(en) || en.includes(itName));

            if (eligibleIds.length === 0 || matchesId || matchesName) {
              orderStamps += Number(it.quantity || 1);
            }
          });
        }
        if (orderStamps > 0) {
          events.push({
            type: "order",
            date: new Date(o.createdAt),
            stamps: orderStamps,
          });
        }
      }
    } catch (err) {
      console.error(`Failed to calculate stamps from tenant DB for user ${user.id}:`, err.message);
    }
  }

  // 3. Count generated coupons for this brand & customer
  try {
    const customerCoupons = await mainPrisma.earnedCoupon.findMany({
      where: {
        appUserId: user.id,
        tenantId: tenant.id,
      },
      select: { id: true, createdAt: true, isUsed: true, usedAt: true, expiresAt: true },
    });

    customerCoupons.forEach((c) => {
      events.push({
        type: "coupon_gen",
        date: new Date(c.createdAt),
        stamps: 0,
      });
      if (c.isUsed) {
        events.push({
          type: "coupon_redeem",
          date: new Date(c.usedAt || c.updatedAt || c.createdAt),
          stamps: 0,
        });
      }
    });
  } catch (couponErr) {
    console.error("[STAMPS] Error loading customer coupons:", couponErr.message);
  }

  // 4. Sort all events chronologically
  events.sort((a, b) => a.date - b.date);

  let cumulative = 0;
  let hasUnclaimedCoupon = false;

  if (events.length === 0 && wallet && typeof wallet.stamps === "number") {
    cumulative = wallet.stamps;
  } else {
    events.forEach((ev) => {
      if (ev.type === "order") {
        // If customer already has an unclaimed reward coupon, they do not earn new stamps until redeemed
        if (!hasUnclaimedCoupon) {
          cumulative += ev.stamps;
          if (cumulative >= requiredStamps) {
            cumulative = requiredStamps;
          }
        }
      } else if (ev.type === "coupon_gen") {
        hasUnclaimedCoupon = true;
        cumulative = requiredStamps;
      } else if (ev.type === "coupon_redeem") {
        hasUnclaimedCoupon = false;
        cumulative = 0;
      } else if (ev.type === "stamp_adjust") {
        if (ev.mode === "set" && typeof ev.total === "number" && !isNaN(ev.total)) {
          cumulative = Math.min(requiredStamps, Math.max(0, ev.total));
        } else {
          cumulative = Math.min(requiredStamps, Math.max(0, cumulative + (ev.delta || 0)));
        }
        if (cumulative < requiredStamps) {
          hasUnclaimedCoupon = false;
        }
      }
    });
  }

  const finalStamps = Math.min(requiredStamps, Math.max(0, cumulative));

  if (!wallet) {
    try {
      wallet = await mainPrisma.wallet.create({
        data: {
          appUserId: user.id,
          tenantId: tenant.id,
          points: 0,
          lifetimeEarn: 0,
          tier: "bronze",
          stamps: finalStamps,
        },
      });
    } catch (e) {
      console.error("Failed to auto-create wallet in syncCustomerStamps:", e.message);
    }
  } else if (wallet.stamps !== finalStamps) {
    try {
      wallet = await mainPrisma.wallet.update({
        where: { id: wallet.id },
        data: { stamps: finalStamps },
      });
    } catch (e) {
      console.error("Failed to update wallet stamps:", e.message);
    }
  }

  return {
    stamps: finalStamps,
    wallet,
  };
};

/**
 * Verifies OTP code, ensures customer appUser & wallet exists for the brand,
 * synchronizes customer stamps from completed orders,
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
      dbUrl: true,
    },
  });

  if (!tenant) {
    throw new ApiError(404, "Brand not found");
  }

  // Verify OTP
  const isDevBypass = isDevOtpBypass(code);
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

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = (stampId ? stampList.find((s) => s.id === stampId) : null) || stampList[0] || null;

  // Calculate & sync customer's earned stamps dynamically from completed brand orders
  const syncResult = await syncCustomerStamps(user, tenant, stampProg);
  const currentStamps = syncResult.stamps;

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
      stamps: (activeCouponData && currentStamps >= Number(stampProg?.requiredStamps || 6))
        ? Number(stampProg?.requiredStamps || 6)
        : currentStamps,
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
 * Fetches the customer's stamp card with live synced stamps.
 */
const getCustomerStampCard = async ({ customerId, tenantId, token }) => {
  let resolvedTenantId = tenantId;
  let stampId = null;

  if (token) {
    try {
      const decoded = decodeQrToken(token);
      resolvedTenantId = decoded.tenantId || resolvedTenantId;
      stampId = decoded.stampId || null;
    } catch (err) {
      // Ignored
    }
  }

  if (!resolvedTenantId || !customerId) {
    throw new ApiError(400, "Brand context and customerId are required");
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
      dbUrl: true,
    },
  });

  if (!tenant) {
    throw new ApiError(404, "Brand not found");
  }

  const user = await mainPrisma.appUser.findUnique({
    where: { id: customerId },
  });

  if (!user) {
    throw new ApiError(404, "Customer not found");
  }

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = (stampId ? stampList.find((s) => s.id === stampId) : null) || stampList[0] || null;

  // Calculate & sync stamps from completed orders
  const syncResult = await syncCustomerStamps(user, tenant, stampProg);
  const currentStamps = syncResult.stamps;

  // Check for any active, unredeemed coupon
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

  const qrPayload = JSON.stringify({
    customerId: user.id,
    phone: user.phone,
    tenantId: tenant.id,
    type: "STAMP",
  });

  const customerStampToken = encodeQrToken({
    tenantId: tenant.id,
    customerId: user.id,
    type: "CUSTOMER_STAMP",
  });

  return {
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
      stamps: (activeCouponData && currentStamps >= Number(stampProg?.requiredStamps || 6))
        ? Number(stampProg?.requiredStamps || 6)
        : currentStamps,
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

  const user = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  const candidates = user ? getPhoneCandidates(user.phone) : [];

  const OR = [
    { customerId },
    { userId: customerId },
  ];
  if (candidates.length > 0) {
    OR.push({ customerPhone: { in: candidates } });
  }

  // Find customer's completed orders
  const orders = await tenantDb.order.findMany({
    where: {
      OR,
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

  if (items.length === 0) {
    items = await tenantDb.menuItem.findMany({
      where: { isAvailable: true },
      take: 20,
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

  const user = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  if (user) {
    await syncCustomerStamps(user, tenant, stampProg);
  }

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
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days valid
    },
  });

  // Note: Stamps remain intact (e.g. 4/4) until the coupon is claimed / redeemed at the cashier / POS.
  // Stamps and coupons are tracked in EarnedCoupon and Wallet.stamps, strictly keeping wallet transactions for points.

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

/**
 * Redeems an EarnedCoupon at POS / cashier or counter:
 * 1. Marks coupon as used (isUsed = true)
 * 2. Decrements wallet.stamps: Math.max(0, wallet.stamps - requiredStamps)
 * 3. Creates an order without payment with the menu item associated with the generated coupon, directly COMPLETED
 */
const redeemRewardCoupon = async ({ code, customerId, tenantId, branchId = null }) => {
  if (!code) {
    throw new ApiError(400, "Coupon code is required");
  }

  const cleanCode = code.trim().toUpperCase();

  const coupon = await mainPrisma.earnedCoupon.findFirst({
    where: {
      code: cleanCode,
      ...(tenantId ? { tenantId } : {}),
      ...(customerId ? { appUserId: customerId } : {}),
    },
    include: {
      appUser: true,
      tenant: true,
    },
  });

  if (!coupon) {
    throw new ApiError(404, "Invalid or unrecognized reward coupon code");
  }

  if (coupon.isUsed) {
    throw new ApiError(400, `Reward coupon ${cleanCode} has already been redeemed`);
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    throw new ApiError(400, `Reward coupon ${cleanCode} has expired`);
  }

  // 1. Mark coupon as used
  const updatedCoupon = await mainPrisma.earnedCoupon.update({
    where: { id: coupon.id },
    data: {
      isUsed: true,
      usedAt: new Date(),
    },
  });

  // 2. Resolve required stamps to deduct
  const tenant = coupon.tenant || (await mainPrisma.tenant.findUnique({ where: { id: coupon.tenantId } }));
  const stampList = Array.isArray(tenant?.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = stampList[0] || null;
  const requiredStamps = Number(stampProg?.requiredStamps || 4);

  // 3. Deduct stamps from customer wallet (keep any extra rollover stamps)
  const wallet = await mainPrisma.wallet.findFirst({
    where: {
      appUserId: coupon.appUserId,
      tenantId: coupon.tenantId,
    },
  });

  let remainingStamps = 0;
  if (wallet) {
    await mainPrisma.wallet.update({
      where: { id: wallet.id },
      data: { stamps: 0 },
    });
  }

  // 4. Create an order without payment with the menu item associated with the generated coupon, directly COMPLETED
  let createdOrder = null;
  let targetMenuItem = null;
  if (tenant && tenant.dbUrl) {
    try {
      const { getTenantClient } = require("../../config/tenantManager");
      const tenantDb = getTenantClient(tenant.dbUrl);

      // Locate the associated menu item
      if (coupon.menuItemId) {
        try {
          targetMenuItem = await tenantDb.menuItem.findUnique({
            where: { id: coupon.menuItemId },
          });
        } catch (mErr) {
          console.error("Failed to find menuItem by id:", mErr.message);
        }
      }

      if (!targetMenuItem) {
        const cleanItemName = (coupon.prizeLabel || "")
          .replace(/^Free\s+/i, "")
          .replace(/\s*\(Stamp Reward\)$/i, "")
          .trim();

        if (cleanItemName) {
          try {
            targetMenuItem = await tenantDb.menuItem.findFirst({
              where: {
                OR: [
                  { name: { equals: cleanItemName, mode: "insensitive" } },
                  { nameAr: { equals: cleanItemName, mode: "insensitive" } },
                ],
              },
            });
          } catch (err) {}
        }

        if (!targetMenuItem) {
          try {
            targetMenuItem =
              (await tenantDb.menuItem.findFirst({ where: { isAvailable: true } })) ||
              (await tenantDb.menuItem.findFirst());
          } catch (err) {}
        }
      }

      // Locate the branch
      let targetBranch = null;
      if (branchId && branchId !== "all") {
        try {
          targetBranch = await tenantDb.branch.findUnique({ where: { id: branchId } });
        } catch (err) {}
      }
      if (!targetBranch) {
        try {
          targetBranch =
            (await tenantDb.branch.findFirst({ where: { isOpen: true } })) ||
            (await tenantDb.branch.findFirst());
        } catch (err) {}
      }

      if (targetBranch && targetMenuItem) {
        const crypto = require("crypto");
        const orderNumber = `SRV-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

        createdOrder = await tenantDb.order.create({
          data: {
            orderNumber,
            status: "COMPLETED", // directly completed as requested
            type: "TAKEAWAY",
            total: 0.0, // without payment
            feeRate: 0.0,
            loyaltyEarnRate: 0.0,
            customerId: coupon.appUserId || customerId || null,
            customerPhone: coupon.appUser?.phone || null,
            branchId: targetBranch.id,
            source: "management",
            paymentMethod: "coupon",
            notes: `Free Stamp Reward: ${targetMenuItem.name} | Coupon: ${cleanCode} [POINTS_ELIGIBLE:false] [STAMPS_ELIGIBLE:false]`,
            items: {
              create: [
                {
                  menuItemId: targetMenuItem.id,
                  quantity: 1,
                  price: 0.0,
                  notes: `Stamp Reward Coupon: ${cleanCode}`,
                },
              ],
            },
          },
          include: {
            items: { include: { menuItem: true } },
            branch: true,
          },
        });

        // Mirror to main database order table
        try {
          await mainPrisma.order.create({
            data: {
              id: createdOrder.id,
              orderNumber: createdOrder.orderNumber,
              status: "COMPLETED",
              type: createdOrder.type,
              total: 0.0,
              notes: createdOrder.notes,
              feeRate: 0.0,
              loyaltyEarnRate: 0.0,
              paymentMethod: "coupon",
              tenantId: coupon.tenantId,
              branchId: targetBranch.id,
              source: "management",
              appUserId: coupon.appUserId || customerId || null,
              createdAt: createdOrder.createdAt,
              updatedAt: createdOrder.updatedAt,
            },
          });
        } catch (mainErr) {
          console.error("[REDEEM COUPON] Failed to mirror order to mainPrisma.order:", mainErr.message);
        }

        // Mirror to main database aggregatedOrder table
        try {
          const cName = coupon.appUser?.name || coupon.appUser?.phone || "Customer Walk-in";
          await mainPrisma.aggregatedOrder.upsert({
            where: { id: `${coupon.tenantId}_${createdOrder.id}` },
            create: {
              id: `${coupon.tenantId}_${createdOrder.id}`,
              tenantId: coupon.tenantId,
              orderId: createdOrder.id,
              orderNumber: createdOrder.orderNumber,
              status: "COMPLETED",
              type: createdOrder.type,
              total: 0.0,
              notes: createdOrder.notes,
              customerName: cName,
              customerPhone: coupon.appUser?.phone || null,
              branchName: targetBranch.name || "Main Branch",
              feeRate: 0.0,
              source: "management",
              paymentMethod: "coupon",
              items: [
                {
                  name: targetMenuItem.name,
                  quantity: 1,
                  price: 0.0,
                },
              ],
              createdAt: createdOrder.createdAt,
              updatedAt: createdOrder.updatedAt,
            },
            update: {
              status: "COMPLETED",
              total: 0.0,
              notes: createdOrder.notes,
              updatedAt: createdOrder.updatedAt,
            },
          });
        } catch (aggErr) {
          console.error("[REDEEM COUPON] Failed to upsert aggregatedOrder:", aggErr.message);
        }
      }
    } catch (orderErr) {
      console.error("[REDEEM COUPON] Failed to create completed reward order:", orderErr.message);
    }
  }

  return {
    coupon: {
      id: updatedCoupon.id,
      code: updatedCoupon.code,
      prizeLabel: updatedCoupon.prizeLabel,
      isUsed: true,
      usedAt: updatedCoupon.usedAt,
    },
    order: createdOrder
      ? {
          id: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          status: createdOrder.status,
          total: createdOrder.total,
          itemName: targetMenuItem?.name || updatedCoupon.prizeLabel,
        }
      : null,
    remainingStamps,
    message: createdOrder
      ? `Reward coupon ${cleanCode} claimed successfully! Free reward order #${createdOrder.orderNumber} created with status COMPLETED.`
      : `Reward coupon ${cleanCode} redeemed successfully!`,
  };
};

const getCouponDetails = async ({ code, tenantId }) => {
  if (!code) {
    throw new ApiError(400, "Coupon code is required");
  }

  const cleanCode = code.trim().toUpperCase();

  const coupon = await mainPrisma.earnedCoupon.findFirst({
    where: {
      code: cleanCode,
      ...(tenantId ? { tenantId } : {}),
    },
    include: {
      appUser: {
        select: { id: true, name: true, phone: true, email: true },
      },
      tenant: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  if (!coupon) {
    throw new ApiError(404, `Coupon code "${cleanCode}" not found`);
  }

  const isExpired = Boolean(coupon.expiresAt && new Date(coupon.expiresAt) < new Date());

  return {
    coupon: {
      id: coupon.id,
      code: coupon.code,
      prizeLabel: coupon.prizeLabel,
      prizeImageUrl: coupon.prizeImageUrl,
      menuItemId: coupon.menuItemId,
      isUsed: coupon.isUsed,
      usedAt: coupon.usedAt,
      expiresAt: coupon.expiresAt,
      isExpired,
      customer: coupon.appUser,
      tenantId: coupon.tenantId,
      tenantName: coupon.tenant?.name,
    },
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
  getCustomerStampCard,
  syncCustomerStamps,
  getEligibleItemsHistory,
  claimRewardCoupon,
  generateRewardCoupon: claimRewardCoupon,
  redeemRewardCoupon,
  getCouponDetails,
  updateCustomerName,
};
