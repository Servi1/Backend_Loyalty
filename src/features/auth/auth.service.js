const prisma = require("../../config/prisma");
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
const signToken = (userId) =>
  jwt.sign({ sub: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

/**
 * Send OTP to a phone number (Consumer App flow).
 */
const sendOtp = async (phone) => {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await prisma.otp.create({ data: { phone, code, expiresAt } });

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

/**
 * Verify OTP and return a token + user (creates user if first login).
 */
const verifyOtp = async (phone, code) => {
  const otp = await prisma.otp.findFirst({
    where: { phone, code, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) throw new ApiError(400, "Invalid or expired OTP");

  await prisma.otp.update({ where: { id: otp.id }, data: { verified: true } });

  let user = await prisma.user.findUnique({ where: { phone } });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.user.create({
      data: { phone, role: "CUSTOMER" },
    });
    // Create wallet for new customer
    await prisma.wallet.create({ data: { userId: user.id } });
  }

  const token = signToken(user.id);
  return { token, user, isNewUser };
};

/**
 * B2B portal login (email + password).
 */
const loginWithEmail = async (email, password) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) throw new ApiError(401, "Invalid credentials");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  const token = signToken(user.id);
  return { token, user };
};

module.exports = { sendOtp, verifyOtp, loginWithEmail };
