/**
 * Public Customer Stamp Routes
 *
 * GET  /api/app/stamp/info        → resolve brand stamp program details by encrypted token or tenantId
 * POST /api/app/stamp/check-phone → check if customer exists, send OTP (1111)
 * POST /api/app/stamp/verify-otp  → verify OTP, register/enroll customer, return stamp card & customer QR
 */

const { Router } = require("express");
const ctrl = require("./stamp.controller");

const router = Router({ mergeParams: true });

router.get("/info", ctrl.getStampProgramInfo);
router.get("/card", ctrl.getCustomerCard);
router.post("/check-phone", ctrl.checkCustomerPhone);
router.post("/verify-otp", ctrl.verifyOtpAndGetCard);
router.get("/eligible-items", ctrl.getEligibleItems);
router.post("/generate-coupon", ctrl.claimReward);
router.post("/claim-coupon", ctrl.claimReward);
router.post("/redeem-coupon", ctrl.redeemCoupon);
router.post("/update-name", ctrl.updateCustomerName);

module.exports = router;
