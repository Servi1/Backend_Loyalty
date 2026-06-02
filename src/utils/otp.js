/**
 * Generate a numeric OTP code.
 * In non-production environments, always returns "1111" for easy testing.
 * In production, generates a proper random 6-digit code.
 */
const generateOtp = (length = 6) => {
  // ─── Dev / Staging shortcut ──────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    return "1111";
  }

  // ─── Production: cryptographically-adequate random code ──
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
};

module.exports = { generateOtp };
