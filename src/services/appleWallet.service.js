/**
 * Apple Wallet (.pkpass) Pass Generator Service
 * Generates cryptographically signed Apple Wallet passes for earned stamp reward coupons.
 */

const fs = require("fs");
const path = require("path");
const { PKPass } = require("passkit-generator");
const mainPrisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

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

  const iconPath = path.resolve(__dirname, "../../../servi_management/assets/icon.png");
  const logoPath = path.resolve(__dirname, "../../../servi_website/public/SERVI-LOGO-TRANSPARENT-WHITE.png");

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

module.exports = {
  generateCouponPass,
};
