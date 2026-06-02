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
const { syncToAggregatedCustomer } = require("../../shared/customers/customers.service");

// ─── OTP Constant (dev) ───────────────────────────────────────────────────────
const DEV_OTP = "1111";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const signToken = (userId) =>
  jwt.sign({ sub: userId, type: "customer" }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

/**
 * Normalise phone: strip spaces/dashes, ensure it has a leading +.
 * e.g.  "966 50 123 4567" → "+966501234567"
 */
const normalisePhone = (raw) => {
  let phone = String(raw).replace(/[\s\-().]/g, "");
  if (!phone.startsWith("+")) phone = "+" + phone;
  return phone;
};

// ─── sendOtp ─────────────────────────────────────────────────────────────────

const sendOtp = async (db, rawPhone) => {
  const phone = normalisePhone(rawPhone);

  // Invalidate any previous unused OTPs for this phone
  await db.otp.updateMany({
    where: { phone, verified: false },
    data: { verified: true }, // mark old ones as used so they won't match
  });

  const code = process.env.NODE_ENV !== "production" ? DEV_OTP : _generateSecureOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.otp.create({ data: { phone, code, expiresAt } });

  // In production: call your SMS provider here
  if (process.env.NODE_ENV !== "production") {
    console.log(`[APP-AUTH] OTP for ${phone}: ${code}  (static dev code)`);
  }

  return { message: "OTP sent successfully" };
};

// ─── verifyOtp ───────────────────────────────────────────────────────────────

const verifyOtp = async (db, rawPhone, code, tenantId) => {
  const phone = normalisePhone(rawPhone);

  // Find the latest unverified, non-expired OTP
  const otp = await db.otp.findFirst({
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
  await db.otp.update({ where: { id: otp.id }, data: { verified: true } });

  // ── Find or create user ──────────────────────────────────────────
  let user = await db.user.findUnique({
    where: { phone },
    include: { wallet: true },
  });
  const isNewUser = !user;

  if (!user) {
    // Check global registry — customer may already exist under another brand
    const globalCustomer = await mainPrisma.aggregatedCustomer.findFirst({
      where: { phone },
      orderBy: { updatedAt: "desc" },
    });

    const initialPoints = globalCustomer?.points ?? 0;

    user = await db.user.create({
      data: {
        phone,
        name: globalCustomer?.name ?? null,
        email: globalCustomer?.email ?? null,
        role: "CUSTOMER",
      },
    });

    // Create wallet seeded with cross-brand points
    const wallet = await db.wallet.create({
      data: {
        userId: user.id,
        points: initialPoints,
        lifetimeEarn: initialPoints,
      },
    });

    user = { ...user, wallet };

    // Sync to global aggregated registry (fire & forget)
    if (tenantId) {
      syncToAggregatedCustomer(db, tenantId, user.id).catch(console.error);
    }
  } else {
    // Returning user — resync points from global registry if out of date
    const globalCustomer = await mainPrisma.aggregatedCustomer.findFirst({
      where: { phone },
      orderBy: { updatedAt: "desc" },
    });
    if (
      globalCustomer &&
      user.wallet &&
      user.wallet.points !== globalCustomer.points
    ) {
      await db.wallet.update({
        where: { id: user.wallet.id },
        data: { points: globalCustomer.points },
      });
      user.wallet.points = globalCustomer.points;
    }
  }

  const token = signToken(user.id);

  return {
    token,
    isNewUser,
    user: _formatUser(user),
  };
};

// ─── getMe ───────────────────────────────────────────────────────────────────

const getMe = async (db, userId) => {
  const user = await db.user.findUnique({
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
  return _formatUser(user);
};

// ─── Private helpers ─────────────────────────────────────────────────────────

const _generateSecureOtp = (length = 6) => {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
};

const _formatUser = (user) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  email: user.email,
  role: user.role,
  avatarUrl: user.avatarUrl,
  wallet: user.wallet
    ? {
        id: user.wallet.id,
        points: user.wallet.points,
        lifetimeEarn: user.wallet.lifetimeEarn,
        transactions: user.wallet.transactions ?? [],
      }
    : null,
  createdAt: user.createdAt,
});

module.exports = { sendOtp, verifyOtp, getMe, normalisePhone };
