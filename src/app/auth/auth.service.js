/**
 * App Auth Service — Mobile OTP Authentication
 *
 * Handles:
 *  - sendOtp:   Creates/upserts an OTP record. In dev, always uses "1111".
 *  - verifyOtp: Validates OTP, auto-creates user + wallet on first login.
 *  - getMe:     Returns the authenticated customer's full profile + wallet.
 */

const jwt = require("jsonwebtoken");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");

// ─── OTP Constant (dev) ───────────────────────────────────────────────────────
const DEV_OTP = "1111";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const signToken = (userId) =>
  jwt.sign({ sub: userId, type: "customer" }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

const normalisePhone = (raw) => {
  let phone = String(raw).replace(/[\s\-().]/g, "");
  if (!phone.startsWith("+")) phone = "+" + phone;
  return phone;
};

// ─── sendOtp ─────────────────────────────────────────────────────────────────

const sendOtp = async (rawPhone) => {
  const phone = normalisePhone(rawPhone);

  // Invalidate any previous unused OTPs for this phone
  await mainPrisma.otp.updateMany({
    where: { phone, verified: false },
    data: { verified: true },
  });

  const code = process.env.NODE_ENV !== "production" ? DEV_OTP : _generateSecureOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await mainPrisma.otp.create({ data: { phone, code, expiresAt } });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[APP-AUTH] OTP for ${phone}: ${code}  (static dev code)`);
  }

  return { message: "OTP sent successfully" };
};

// ─── verifyOtp ───────────────────────────────────────────────────────────────

const verifyOtp = async (rawPhone, code, tenantId = null) => {
  const phone = normalisePhone(rawPhone);

  // Find the latest unverified, non-expired OTP
  const otp = await mainPrisma.otp.findFirst({
    where: {
      phone,
      code,
      verified: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) throw new ApiError(400, "Invalid or expired OTP");

  // Mark as consumed
  await mainPrisma.otp.update({ where: { id: otp.id }, data: { verified: true } });

  // ── Find or create user globally ──────────────────────────────────────────
  let user = await mainPrisma.appUser.findUnique({
    where: { phone },
    include: { wallet: { include: { transactions: { orderBy: { createdAt: "desc" }, take: 10 } } } },
  });
  if (user && user.isDelete) {
    throw new ApiError(400, "user already exists, please contact the admin.");
  }
  const isNewUser = !user || !user.name;

  if (!user) {
    user = await mainPrisma.appUser.create({
      data: {
        phone,
      },
    });

    // Create wallet globally
    const wallet = await mainPrisma.wallet.create({
      data: {
        appUserId: user.id,
        points: 0,
        lifetimeEarn: 0,
      },
      include: { transactions: true }
    });

    user = { ...user, wallet };
  }

  const token = signToken(user.id);
  
  // Optionally fetch brand-specific stats if tenantId is provided
  let stats = { ordersCount: 0, totalSpent: 0 };
  if (tenantId) {
    try {
      const tenant = await mainPrisma.tenant.findFirst({
        where: {
          OR: [
            { id: tenantId },
            { slug: tenantId }
          ]
        }
      });
      if (tenant) {
        const { getTenantClient } = require("../../config/tenantManager");
        const tenantDb = getTenantClient(tenant.dbUrl);
        stats = await _getUserStats(tenantDb, user.id);
      }
    } catch (err) {
      console.error("Failed to load tenant stats during verifyOtp:", err.message);
    }
  }

  return {
    token,
    isNewUser,
    user: {
      ...(await _formatUser(user)),
      ...stats,
    },
  };
};

// ─── getMe ───────────────────────────────────────────────────────────────────

const getMe = async (db, userId) => {
  const user = await mainPrisma.appUser.findUnique({
    where: { id: userId },
    include: {
      wallet: {
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      },
    },
  });
  if (!user) throw new ApiError(404, "User not found");

  const stats = db ? await _getUserStats(db, userId) : { ordersCount: 0, totalSpent: 0 };

  return {
    ...(await _formatUser(user)),
    ...stats,
  };
};

// ─── Private helpers ─────────────────────────────────────────────────────────

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
    logo: config.getAppImageURL(t.logoUrl) || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=100&h=100&fit=crop',
    hero: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop',
    slug: t.slug,
    isFavorite: true,
    cuisine: 'Restaurant',
  }));
};

const _getUserStats = async (db, userId) => {
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

  return { ordersCount, totalSpent };
};

const _generateSecureOtp = (length = 6) => {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
};

const _formatUser = async (user) => {
  const favoriteBrandsDetails = await getFavoriteBrandsDetails(user.favoriteBrands || []);
  return {
    id: user.id,
    name: user.name,
    lastName: user.lastName,
    phone: user.phone,
    email: user.email,
    gender: user.gender,
    dob: user.dob,
    role: "CUSTOMER",
    avatarUrl: config.getAppImageURL(user.avatarUrl),
    cars: user.cars || [],
    addresses: user.addresses || [],
    paymentMethods: user.paymentMethods || [],
    favoriteBrands: user.favoriteBrands || [],
    favoriteBrandsDetails,
    wallet: user.wallet
      ? {
          id: user.wallet.id,
          points: user.wallet.points,
          lifetimeEarn: user.wallet.lifetimeEarn,
          transactions: user.wallet.transactions ?? [],
        }
      : null,
    createdAt: user.createdAt,
  };
};

module.exports = { sendOtp, verifyOtp, getMe, normalisePhone };
