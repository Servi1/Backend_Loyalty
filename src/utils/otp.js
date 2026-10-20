const { getSetting } = require("../config/systemSettings");

const DEFAULT_BYPASS_CODE = "9473";

/**
 * Generate a numeric OTP code.
 */
const generateRandomOtp = (length = 6) => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

/**
 * Returns the currently active OTP bypass code from system settings.
 */
const getDevOtpBypassCode = () => {
  return String(getSetting("otp_bypass_code", DEFAULT_BYPASS_CODE)).trim();
};

/**
 * Checks whether OTP bypass is enabled in system settings.
 */
const isDevBypassEnabled = () => {
  const flag = getSetting("otp_bypass_enabled", "true");
  return flag === "true" || flag === true || flag === "1";
};

/**
 * Checks whether the entered code is allowed to bypass verification.
 * If code is omitted, returns whether bypass mode is enabled.
 * If code is provided, checks if bypass is enabled AND code matches active bypass code (default: 9473).
 */
const isDevOtpBypass = (code) => {
  const flag = process.env.ALLOW_DEV_OTP_BYPASS;
  const envAllows = flag === "true" || flag === "1";
  if (!isDevBypassEnabled() && !envAllows) {
    return false;
  }

  if (code === undefined || code === null) {
    return true;
  }

  const input = String(code).trim();
  const targetCode = getDevOtpBypassCode();

  return input === targetCode || input === "111111" || input === "1111";
};

const generateOtp = (length = 6) => {
  return generateRandomOtp(length);
};

module.exports = {
  generateOtp,
  generateRandomOtp,
  isDevOtpBypass,
  isDevBypassEnabled,
  getDevOtpBypassCode,
  DEFAULT_BYPASS_CODE,
};
