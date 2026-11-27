/**
 * Apple Wallet (.pkpass) Pass Generator Service
 * Generates cryptographically signed Apple Wallet passes for earned stamp reward coupons.
 */

const fs = require("fs");
const path = require("path");
const { PKPass } = require("passkit-generator");
const mainPrisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { decodeQrToken } = require("../utils/qrToken.utils");

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  // sharp may not be available in local environment
}

let cachedCerts = null;
let cachedAssets = null;

const loadCertificates = () => {
  if (cachedCerts) return cachedCerts;

  const certsDir = path.resolve(__dirname, "../../certs");
  const signerCertPath = path.join(certsDir, "signerCert.pem");
  const signerKeyPath = path.join(certsDir, "signerKey.pem");
  const wwdrPath = path.join(certsDir, "wwdr.pem");

  if (!fs.existsSync(signerCertPath) || !fs.existsSync(signerKeyPath) || !fs.existsSync(wwdrPath)) {
    throw new ApiError(500, "Apple Wallet certificates are not properly configured on the server.");
  }

  cachedCerts = {
    signerCert: fs.readFileSync(signerCertPath, "utf8"),
    signerKey: fs.readFileSync(signerKeyPath, "utf8"),
    wwdr: fs.readFileSync(wwdrPath, "utf8"),
  };

  return cachedCerts;
};

const loadDefaultAssets = () => {
  if (cachedAssets) return cachedAssets;

  const localIcon = path.resolve(__dirname, "../assets/icon.png");
  const fallbackIcon = path.resolve(__dirname, "../../../servi_management/assets/icon.png");
  const iconPath = fs.existsSync(localIcon) ? localIcon : fallbackIcon;

  const localLogo = path.resolve(__dirname, "../assets/SERVI-LOGO-TRANSPARENT-WHITE.png");
  const fallbackLogo = path.resolve(__dirname, "../../../servi_website/public/SERVI-LOGO-TRANSPARENT-WHITE.png");
  const logoPath = fs.existsSync(localLogo) ? localLogo : fallbackLogo;

  let iconBuffer = Buffer.alloc(0);
  let logoBuffer = Buffer.alloc(0);

  if (fs.existsSync(iconPath)) {
    iconBuffer = fs.readFileSync(iconPath);
  }
  if (fs.existsSync(logoPath)) {
    logoBuffer = fs.readFileSync(logoPath);
  }

  cachedAssets = {
    icon: iconBuffer,
    logo: logoBuffer,
  };

  return cachedAssets;
};

/**
 * Generates an Apple Wallet .pkpass buffer for a specific EarnedCoupon
 * @param {string} couponIdOrCode - ID or code of the EarnedCoupon
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
const generateCouponPass = async (couponIdOrCode) => {
  if (!couponIdOrCode) {
    throw new ApiError(400, "Coupon identifier is required");
  }

  const coupon = await mainPrisma.earnedCoupon.findFirst({
    where: {
      OR: [{ id: couponIdOrCode }, { code: couponIdOrCode }],
    },
    include: {
      tenant: true,
      appUser: true,
    },
  });

  if (!coupon) {
    throw new ApiError(404, "Coupon not found");
  }

  const certs = loadCertificates();
  const assets = loadDefaultAssets();

  const brandName = coupon.tenant?.name || "Servi Brand";
  const customerName = coupon.appUser?.name && coupon.appUser.name !== "Valued Customer"
    ? coupon.appUser.name
    : "Valued Customer";
  const prizeLabel = coupon.prizeLabel?.replace(" (Stamp Reward)", "") || "Free Reward Item";

  const expiryDate = new Date(coupon.expiresAt);
  const formattedExpiry = expiryDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const passJson = {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || "pass.servi.Pass.Type.ID.wallet",
    teamIdentifier: process.env.APPLE_TEAM_ID || "2CC693L34B",
    organizationName: brandName,
    description: `${brandName} Reward Coupon`,
    formatVersion: 1,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(0, 0, 0)", // Sleek black theme
    labelColor: "rgb(203, 213, 225)",
    coupon: {
      headerFields: [
        {
          key: "expires",
          label: "EXPIRES",
          value: formattedExpiry,
        },
      ],
      primaryFields: [
        {
          key: "reward",
          label: "FREE REWARD",
          value: prizeLabel,
        },
      ],
      secondaryFields: [
        {
          key: "brand",
          label: "BRAND",
          value: brandName,
        },
        {
          key: "customer",
          label: "CUSTOMER",
          value: customerName,
        },
      ],
      auxiliaryFields: [
        {
          key: "code",
          label: "COUPON CODE",
          value: coupon.code,
        },
      ],
      backFields: [
        {
          key: "instructions",
          label: "How to Redeem",
          value: "Show this pass at checkout or to the cashier. The cashier will scan the QR code to redeem your free reward.",
        },
        {
          key: "terms",
          label: "Terms & Conditions",
          value: "Valid for one-time use only at participating branches. Cannot be exchanged for cash or combined with other offers.",
        },
        {
          key: "expiryFull",
          label: "Valid Until",
          value: expiryDate.toISOString(),
        },
        {
          key: "codeFull",
          label: "Coupon Code",
          value: coupon.code,
        },
      ],
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: coupon.code,
        messageEncoding: "iso-8859-1",
        altText: coupon.code,
      },
    ],
  };

  const buffers = {
    "pass.json": Buffer.from(JSON.stringify(passJson)),
    "icon.png": assets.icon,
    "icon@2x.png": assets.icon,
    "logo.png": assets.logo,
    "logo@2x.png": assets.logo,
  };

  const pass = new PKPass(buffers, certs);
  const buffer = pass.getAsBuffer();

  return {
    buffer,
    filename: `${coupon.code}.pkpass`,
    coupon,
  };
};

const getPhoneCandidates = (raw) => {
  if (!raw) return [];
  const digits = raw.toString().trim().replace(/\D/g, "");
  let base = digits;
  if (base.startsWith("966")) base = base.substring(3);
  if (base.startsWith("0")) base = base.substring(1);
  const set = new Set();
  if (base) {
    set.add(`+966${base}`);
    set.add(`966${base}`);
    set.add(`0${base}`);
    set.add(base);
  }
  const str = raw.toString().trim();
  if (str) {
    set.add(str);
    if (!str.startsWith("+")) set.add(`+${str}`);
  }
  return Array.from(set);
};

/**
 * Creates dynamic SVG for Apple Wallet storeCard strip image
 * Layout matches official Apple Wallet guidelines and user UI design:
 * - Clean dark background with subtle radial center glow
 * - Circular stamp slots arranged in 1 row (if <= 7 slots) or 2 rows (if > 7 slots)
 * - Collected stamp: Crisp white filled circle with dark rubber stamp icon
 * - Uncollected stamp: Subtle dark circle with border and muted stamp icon
 * - Reward slot (last): Highlighted cyan ring with gift icon
 * @param {number} collected - Number of stamps collected so far
 * @param {number} required - Total required stamps (slots = required + 1, including reward slot)
 * @returns {string} SVG string (width: 750, height: 280)
 */
function createStampStripSvg(collected, required) {
  const width = 750;
  const height = 280;
  const total = Math.max(1, (required || 6) + 1);

  const isTwoRows = total > 7;
  const row1Count = isTwoRows ? Math.min(7, Math.ceil(total * 0.7)) : total;
  const row2Count = isTwoRows ? total - row1Count : 0;

  const r = isTwoRows ? 26 : 34;
  const row1Y = isTwoRows ? 95 : 140;
  const row2Y = isTwoRows ? 185 : 0;

  let circlesSvg = "";

  function stampIcon(cx, cy, scale = 1, color = "#121418") {
    return `
      <g transform="translate(${cx - 12 * scale}, ${cy - 14 * scale}) scale(${scale * 0.8})">
        <ellipse cx="15" cy="6" rx="6" ry="4" fill="${color}" />
        <path d="M12 7 C12 12, 13 16, 10 20 L20 20 C17 16, 18 12, 18 7 Z" fill="${color}" />
        <rect x="5" y="20" width="20" height="7" rx="2" fill="${color}" />
        <rect x="3" y="27" width="24" height="4" rx="1.5" fill="${color}" opacity="0.8" />
      </g>
    `;
  }

  function giftIcon(cx, cy, scale = 1, color = "#38BDF8") {
    return `
      <g transform="translate(${cx - 12 * scale}, ${cy - 12 * scale}) scale(${scale * 0.8})">
        <rect x="4" y="6" width="22" height="5" rx="1.5" fill="${color}" />
        <rect x="6" y="11" width="18" height="15" rx="2" fill="${color}" />
        <rect x="13.5" y="6" width="3" height="20" fill="#121418" />
        <circle cx="12" cy="4.5" r="2.5" fill="none" stroke="${color}" stroke-width="2" />
        <circle cx="18" cy="4.5" r="2.5" fill="none" stroke="${color}" stroke-width="2" />
      </g>
    `;
  }

  // Draw Row 1
  const row1Spacing = Math.min(85, (width - 120) / (row1Count - 1 || 1));
  const row1StartX = (width - (row1Count - 1) * row1Spacing) / 2;

  for (let i = 0; i < row1Count; i++) {
    const slotIdx = i;
    const isLast = slotIdx === total - 1;
    const isCollected = isLast ? collected >= required : slotIdx < collected;
    const cx = row1StartX + i * row1Spacing;
    const cy = row1Y;

    if (isLast) {
      const ringStroke = isCollected ? "#38BDF8" : "rgba(56, 189, 248, 0.45)";
      const bgFill = isCollected ? "#FFFFFF" : "rgba(255, 255, 255, 0.08)";
      const iconCol = isCollected ? "#0284C7" : "#38BDF8";
      circlesSvg += `
        <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="${ringStroke}" stroke-width="2.5" stroke-dasharray="${isCollected ? "none" : "4,3"}" />
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${bgFill}" />
        ${giftIcon(cx, cy, isTwoRows ? 1.0 : 1.2, iconCol)}
      `;
    } else if (isCollected) {
      circlesSvg += `
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.5))" />
        ${stampIcon(cx, cy, isTwoRows ? 1.0 : 1.2, "#121418")}
      `;
    } else {
      circlesSvg += `
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5" />
        ${stampIcon(cx, cy, isTwoRows ? 1.0 : 1.2, "rgba(255, 255, 255, 0.35)")}
      `;
    }
  }

  // Draw Row 2 (if any)
  if (isTwoRows && row2Count > 0) {
    const row2Spacing = Math.min(85, (width - 120) / (row2Count - 1 || 1));
    const row2StartX = (width - (row2Count - 1) * row2Spacing) / 2;

    for (let i = 0; i < row2Count; i++) {
      const slotIdx = row1Count + i;
      const isLast = slotIdx === total - 1;
      const isCollected = isLast ? collected >= required : slotIdx < collected;
      const cx = row2StartX + i * row2Spacing;
      const cy = row2Y;

      if (isLast) {
        const ringStroke = isCollected ? "#38BDF8" : "rgba(56, 189, 248, 0.45)";
        const bgFill = isCollected ? "#FFFFFF" : "rgba(255, 255, 255, 0.08)";
        const iconCol = isCollected ? "#0284C7" : "#38BDF8";
        circlesSvg += `
          <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="${ringStroke}" stroke-width="2.5" stroke-dasharray="${isCollected ? "none" : "4,3"}" />
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="${bgFill}" />
          ${giftIcon(cx, cy, 1.0, iconCol)}
        `;
      } else if (isCollected) {
        circlesSvg += `
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.5))" />
          ${stampIcon(cx, cy, 1.0, "#121418")}
        `;
      } else {
        circlesSvg += `
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5" />
          ${stampIcon(cx, cy, 1.0, "rgba(255, 255, 255, 0.35)")}
        `;
      }
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1E293B" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#0F172A" stop-opacity="1" />
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#centerGlow)" />
      ${circlesSvg}
    </svg>
  `;
}

/**
 * Generates an Apple Wallet .pkpass buffer for a Customer's Personal Stamp Card
 * Works even if the customer has 0 stamps!
 * @param {Object} params - { customerId, tenantId, phone, token }
 * @returns {Promise<{ buffer: Buffer, filename: string, customer: Object, tenant: Object, currentStamps: number, requiredStamps: number }>}
 */
const generateCustomerStampPass = async ({ customerId, tenantId, phone, token }) => {
  let resolvedTenantId = tenantId;
  let stampId = null;

  if (token) {
    try {
      const decoded = decodeQrToken(token);
      resolvedTenantId = decoded.tenantId || resolvedTenantId;
      stampId = decoded.stampId || null;
    } catch (e) {
      // Ignored
    }
  }

  if (!resolvedTenantId && !customerId && !phone) {
    throw new ApiError(400, "Customer or Brand identifier is required");
  }

  // Find AppUser
  let user = null;
  if (customerId) {
    user = await mainPrisma.appUser.findUnique({ where: { id: customerId } });
  }
  if (!user && phone) {
    const candidates = getPhoneCandidates(phone);
    user = await mainPrisma.appUser.findFirst({
      where: { phone: { in: candidates } },
    });
  }

  if (!user) {
    throw new ApiError(404, "Customer not found");
  }

  // Find Tenant
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

  const stampList = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms : [];
  const stampProg = (stampId ? stampList.find((s) => s.id === stampId) : null) || stampList[0] || null;

  // Calculate live synced stamps
  const { syncCustomerStamps } = require("../app/stamp/stamp.service");
  const syncResult = await syncCustomerStamps(user, tenant, stampProg);
  const currentStamps = syncResult.stamps || 0;
  const requiredStamps = Number(stampProg?.requiredStamps || 6);

  const brandName = tenant.name || "Servi Brand";
  const customerName = user.name && user.name !== "Valued Customer" ? user.name : "Valued Customer";
  const rewardText = stampProg?.rewardTextEn || stampProg?.rewardTextAr || "Free Reward on completion";

  const certs = loadCertificates();
  const assets = loadDefaultAssets();

  // Generate dynamic strip image with sharp
  let strip1x = null;
  let strip2x = null;
  if (sharp) {
    try {
      const svg = createStampStripSvg(currentStamps, requiredStamps);
      strip2x = await sharp(Buffer.from(svg)).png().toBuffer();
      strip1x = await sharp(strip2x).resize(375, 140).png().toBuffer();
    } catch (stripErr) {
      console.error("[APPLE WALLET] Error generating stamp strip image:", stripErr.message);
    }
  }

  // Format scannable QR payload (matches POS scanner format)
  const qrPayload = JSON.stringify({
    customerId: user.id,
    phone: user.phone,
    tenantId: tenant.id,
    type: "STAMP",
  });

  // AltText below QR code (e.g. SRV · 5050 · 5994)
  const phoneDigits = (user.phone || "").replace(/\D/g, "");
  const pLast8 = phoneDigits.slice(-8);
  const altText = pLast8.length >= 8
    ? `SRV · ${pLast8.slice(0, 4)} · ${pLast8.slice(4)}`
    : `SRV · ${phoneDigits.slice(-4) || "LOYALTY"}`;

  const passJson = {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || "pass.servi.Pass.Type.ID.wallet",
    teamIdentifier: process.env.APPLE_TEAM_ID || "2CC693L34B",
    organizationName: brandName,
    description: `${brandName} Stamp Card`,
    formatVersion: 1,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(15, 23, 42)", // Sleek dark slate theme
    labelColor: "rgb(148, 163, 184)",
    logoText: brandName,
    storeCard: {
      headerFields: [
        {
          key: "stamps",
          label: "STAMPS",
          value: `${currentStamps}/${requiredStamps}`,
        },
      ],
      secondaryFields: [
        {
          key: "nextReward",
          label: "NEXT REWARD",
          value: rewardText,
        },
        {
          key: "member",
          label: "MEMBER",
          value: customerName,
        },
      ],
      backFields: [
        {
          key: "instructions",
          label: "How to Collect Stamps",
          value: "Show this pass to the cashier at the counter on every visit. The cashier will scan your QR code to stamp your card.",
        },
        {
          key: "status",
          label: "Current Status",
          value: `${currentStamps} of ${requiredStamps} stamps collected.`,
        },
        {
          key: "nextRewardDetails",
          label: "Next Reward",
          value: rewardText,
        },
        {
          key: "memberDetails",
          label: "Customer Account",
          value: `${customerName} (${user.phone})`,
        },
        {
          key: "brandDetails",
          label: "Brand",
          value: brandName,
        },
        {
          key: "terms",
          label: "Terms & Conditions",
          value: "Stamps are collected on eligible orders at participating branches. Cannot be exchanged for cash. Non-transferable. Powered by Servi Loyalty.",
        },
      ],
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: qrPayload,
        messageEncoding: "iso-8859-1",
        altText,
      },
    ],
  };

  const buffers = {
    "pass.json": Buffer.from(JSON.stringify(passJson)),
    "icon.png": assets.icon,
    "icon@2x.png": assets.icon,
    "logo.png": assets.logo,
    "logo@2x.png": assets.logo,
  };

  if (strip1x && strip2x) {
    buffers["strip.png"] = strip1x;
    buffers["strip@2x.png"] = strip2x;
  }

  const pass = new PKPass(buffers, certs);
  const buffer = pass.getAsBuffer();

  const cleanBrand = brandName.replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `${cleanBrand}_StampCard.pkpass`;

  return {
    buffer,
    filename,
    customer: user,
    tenant,
    currentStamps,
    requiredStamps,
  };
};

module.exports = {
  generateCouponPass,
  generateCustomerStampPass,
  createStampStripSvg,
};
