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
router.post("/logout", extractTenant, authController.logout);
router.post("/pos/logout", extractTenant, authController.posLogout);
router.post("/kds/login", extractTenant, authController.kdsLogin);
router.post("/kds/logout", extractTenant, authController.kdsLogout);

// ─── Current User ────────────────────────────────────
router.get("/me", extractTenant, authenticate, authController.getMe);


// ─── Dashboard Email Login OTP ───────────────────────
router.post("/verify-login-otp", authController.verifyLoginOtp);
router.post("/resend-login-otp", authController.resendLoginOtp);

// ─── Password Reset ──────────────────────────────────
router.post("/forgot-password", authController.forgotPassword);
router.post("/verify-reset-token", authController.verifyResetToken);
router.post("/reset-password", authController.resetPassword);

module.exports = router;
