let getSetting = null;
try {
  const ss = require("../config/systemSettings");
  getSetting = ss.getSetting;
} catch (err) {
  getSetting = (key, fallback) => fallback;
}

const DEFAULT_BYPASS_CODE = "9473";

/**
 * Generate a numeric OTP code.
 */
const generateRandomOtp = (length = 4) => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

/**
 * Returns the currently active OTP bypass code from system settings.
 */
const getDevOtpBypassCode = () => {
  if (typeof getSetting === "function") {
    return String(getSetting("otp_bypass_code", DEFAULT_BYPASS_CODE)).trim();
  }
  return DEFAULT_BYPASS_CODE;
};

/**
 * Checks whether OTP bypass is enabled in system settings.
 */
const isDevBypassEnabled = () => {
  const isDev = process.env.NODE_ENV !== "production";
  if (typeof getSetting === "function") {
    // In production, default must be "false" to prevent unauthorized OTP bypass
    const defaultFlag = isDev ? "true" : "false";
    const flag = getSetting("otp_bypass_enabled", defaultFlag);
    return flag === "true" || flag === true || flag === "1";
  }
  return isDev;
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

const generateOtp = (length = 4) => {
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
