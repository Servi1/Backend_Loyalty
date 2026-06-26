/**
 * Global App Auth Routes — Mobile Consumer Authentication
 *
 * No tenant context is required for these public endpoints.
 *
 *   POST /api/app/auth/otp/send    — request OTP
 *   POST /api/app/auth/otp/verify  — verify OTP, returns JWT
 */

const { Router } = require("express");
const ctrl = require("./auth.controller");

const router = Router();

router.post("/otp/send", ctrl.sendOtp);
router.post("/otp/verify", ctrl.verifyOtp);

module.exports = router;
