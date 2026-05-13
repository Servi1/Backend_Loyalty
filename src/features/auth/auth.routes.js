const { Router } = require("express");
const authController = require("./auth.controller");
const { authenticate } = require("../../middlewares/authMiddleware");

const router = Router();

// ─── Consumer App (OTP) ──────────────────────────────
router.post("/otp/send", authController.sendOtp);
router.post("/otp/verify", authController.verifyOtp);

// ─── B2B Portal (Email / Password) ───────────────────
router.post("/login", authController.login);

// ─── Current User ────────────────────────────────────
router.get("/me", authenticate, authController.getMe);

module.exports = router;
