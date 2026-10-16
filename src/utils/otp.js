/**
 * Generate a numeric OTP code.
 */
const generateRandomOtp = (length = 6) => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

/**
 * Checks whether the entered code is allowed to bypass verification via the dev bypass flag.
 * Reads ALLOW_DEV_OTP_BYPASS from .env (e.g. true/false).
 */
const isDevOtpBypass = (code) => {
  const trimmed = String(code).trim();
  if (trimmed !== "111111" && trimmed !== "1111") return false;

  const flag = process.env.ALLOW_DEV_OTP_BYPASS;
  if (flag !== undefined) {
    return flag === "true" || flag === "1";
  }

  return process.env.NODE_ENV !== "production";
};

const generateOtp = (length = 6) => {
  return generateRandomOtp(length);
};

module.exports = { generateOtp, generateRandomOtp, isDevOtpBypass };
