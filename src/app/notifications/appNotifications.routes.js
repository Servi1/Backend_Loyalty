const { Router } = require("express");
const catchAsync = require("../../utils/catchAsync");
const mainPrisma = require("../../config/prisma");

const router = Router();

/**
 * Register or update mobile app FCM device token
 * POST /api/app/notifications/register-token
 */
router.post(
  "/register-token",
  catchAsync(async (req, res) => {
    const { fcmToken, phone } = req.body;

    if (!fcmToken || typeof fcmToken !== "string" || !fcmToken.trim()) {
      return res.status(400).json({ success: false, message: "Valid fcmToken is required" });
    }

    const tokenToSave = fcmToken.trim();
    let updatedUser = null;

    // 1. If authenticated app user
    if (req.user && req.user.id) {
      updatedUser = await mainPrisma.appUser.update({
        where: { id: req.user.id },
        data: { fcmToken: tokenToSave }
      }).catch(() => null);
    }

    // 2. If phone number is provided and user wasn't updated yet
    if (!updatedUser && phone && typeof phone === "string") {
      updatedUser = await mainPrisma.appUser.update({
        where: { phone: phone.trim() },
        data: { fcmToken: tokenToSave }
      }).catch(() => null);
    }

    res.json({
      success: true,
      message: "Device notification token registered successfully",
      data: { registered: !!updatedUser, fcmToken: tokenToSave }
    });
  })
);

module.exports = router;
