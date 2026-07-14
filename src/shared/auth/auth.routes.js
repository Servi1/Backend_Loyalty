const { Router } = require("express");
const authController = require("./auth.controller");
const { authenticate } = require("../../middlewares/authMiddleware");
const { extractTenant } = require("../../middlewares/tenantMiddleware");

const router = Router();

// ─── Super Admin Portal ──────────────────────────────
router.post("/super-admin/login", authController.superAdminLogin);

// ─── Consumer App (OTP) ──────────────────────────────
router.post("/otp/send", extractTenant, authController.sendOtp);
router.post("/otp/verify", extractTenant, authController.verifyOtp);

// ─── B2B Portal (Email / Password) ───────────────────
router.post("/login", extractTenant, authController.login);
router.post("/kds/login", extractTenant, authController.kdsLogin);

// ─── Current User ────────────────────────────────────
router.get("/me", extractTenant, authenticate, authController.getMe);

module.exports = router;
