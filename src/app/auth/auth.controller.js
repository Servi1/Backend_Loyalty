/**
 * App Auth Controller — Mobile OTP endpoints
 *
 * POST /api/app/:tenantId/auth/otp/send    → send OTP to phone
 * POST /api/app/:tenantId/auth/otp/verify  → verify OTP, returns JWT + user
 * GET  /api/app/:tenantId/auth/me          → get current user (auth required)
 */

const catchAsync = require("../../utils/catchAsync");
const authService = require("./auth.service");

// ─── POST /auth/otp/send ──────────────────────────────────────────────────────
const sendOtp = catchAsync(async (req, res) => {
  const { phone } = req.body;

  if (!phone || typeof phone !== "string" || phone.trim().length < 7) {
    return res.status(400).json({ success: false, message: "A valid phone number is required" });
  }

  const result = await authService.sendOtp(req.tenantDb, phone.trim());
  res.status(200).json({ success: true, ...result });
});

// ─── POST /auth/otp/verify ────────────────────────────────────────────────────
const verifyOtp = catchAsync(async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ success: false, message: "Phone and OTP code are required" });
  }

  const result = await authService.verifyOtp(
    req.tenantDb,
    phone.trim(),
    String(code).trim(),
    req.tenantId,
  );

  res.status(200).json({ success: true, ...result });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
const getMe = catchAsync(async (req, res) => {
  const user = await authService.getMe(req.tenantDb, req.user.id);
  res.status(200).json({ success: true, user });
});

module.exports = { sendOtp, verifyOtp, getMe };
