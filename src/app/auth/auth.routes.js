/**
 * App Auth Routes
 *
 * All routes are prefixed by the parent router:
 *   /api/app/:tenantId/auth/...
 *
 * Public:
 *   POST /otp/send    — request OTP
 *   POST /otp/verify  — verify OTP, receive JWT
 *
 * Authenticated:
 *   GET  /me          — get current customer profile
 */

const { Router } = require("express");
const ctrl = require("./auth.controller");
const { authenticate } = require("../../middlewares/authMiddleware");
const { requireCustomer } = require("../middlewares/appAuth.middleware");

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post("/otp/send", ctrl.sendOtp);
router.post("/otp/verify", ctrl.verifyOtp);

// ── Authenticated ─────────────────────────────────────────────────────────────
router.get("/me", authenticate, requireCustomer, ctrl.getMe);

module.exports = router;
