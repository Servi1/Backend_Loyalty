const mainPrisma = require("../../config/prisma");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const { generateOtp } = require("../../utils/otp");
const twilio = require("twilio");

let twilioClient = null;
try {
  if (config.twilio.accountSid && config.twilio.accountSid.startsWith("AC") && config.twilio.authToken) {
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
} catch (err) {
  console.warn("⚠️  Twilio not configured — OTPs will be logged to console");
}

/**
 * Create a JWT for a user.
 */
const signToken = (userId, type = "user") =>
  jwt.sign({ sub: userId, type }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

/**
 * Send OTP to a phone number (Consumer App flow).
 */
const sendOtp = async (db, phone) => {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await db.otp.create({ data: { phone, code, expiresAt } });

  // Send via Twilio (skip in development if not configured)
  if (twilioClient && config.twilio.phoneNumber) {
    await twilioClient.messages.create({
      body: `Your Servio verification code is: ${code}`,
      from: config.twilio.phoneNumber,
      to: phone,
    });
  } else {
    console.log(`[DEV] OTP for ${phone}: ${code}`);
  }

  return { message: "OTP sent" };
};

const { syncToAggregatedCustomer } = require("../customers/customers.service");

/**
 * Verify OTP and return a token + user (creates user if first login).
 */
const verifyOtp = async (db, phone, code, tenantId) => {
  const otp = await db.otp.findFirst({
    where: { phone, code, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) throw new ApiError(400, "Invalid or expired OTP");

  await db.otp.update({ where: { id: otp.id }, data: { verified: true } });

  let user = await db.user.findUnique({ where: { phone }, include: { wallet: true } });
  const isNewUser = !user;

  if (user) {
    // Sync points to global balance if out of sync
    const globalCustomer = await mainPrisma.aggregatedCustomer.findFirst({
      where: { phone },
      orderBy: { updatedAt: "desc" },
    });
    if (globalCustomer && user.wallet && user.wallet.points !== globalCustomer.points) {
      await db.wallet.update({
        where: { id: user.wallet.id },
        data: { points: globalCustomer.points }
      });
      user.wallet.points = globalCustomer.points;
    }
  } else {
    // Check if customer exists in another tenant's database via the aggregated table
    const globalCustomer = await mainPrisma.aggregatedCustomer.findFirst({
      where: { phone },
      orderBy: { updatedAt: "desc" },
    });

    const initialPoints = globalCustomer ? globalCustomer.points : 0;

    user = await db.user.create({
      data: {
        phone,
        name: globalCustomer?.name || null,
        email: globalCustomer?.email || null,
        role: "CUSTOMER",
      },
    });

    // Create wallet with matched global points balance
    await db.wallet.create({
      data: {
        userId: user.id,
        points: initialPoints,
        lifetimeEarn: initialPoints,
      },
    });

    if (tenantId) {
      syncToAggregatedCustomer(db, tenantId, user.id).catch(console.error);
    }
  }

  const token = signToken(user.id, "user");
  return { token, user, isNewUser };
};

/**
 * B2B portal login (email + password).
 */
const loginWithEmail = async (db, email, password) => {
  const user = await db.user.findUnique({ where: { email }, include: { branch: true } });
  if (!user) throw new ApiError(401, "Invalid credentials");

  // Check if PIN code is provided as password for cashier/waiter
  if (user.pinCode && password === user.pinCode) {
    const token = signToken(user.id, "user");
    return { token, user };
  }

  // Fallback to standard bcrypt password check
  if (!user.password) throw new ApiError(401, "Invalid credentials");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  const token = signToken(user.id, "user");
  return { token, user };
};

/**
 * Super Admin login (main DB).
 */
const superAdminLogin = async (email, password) => {
  const admin = await mainPrisma.superAdmin.findUnique({ where: { email } });
  if (!admin) throw new ApiError(401, "Invalid credentials");

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  const token = signToken(admin.id, "super_admin");
  return { token, admin };
};

module.exports = { sendOtp, verifyOtp, loginWithEmail, superAdminLogin };
