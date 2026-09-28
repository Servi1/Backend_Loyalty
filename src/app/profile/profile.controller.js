/**
 * App Profile Controller
 *
 * PATCH /profile      → update name / email / avatar
 * DELETE /profile     → anonymise / delete account
 */

const catchAsync = require("../../utils/catchAsync");
const ApiError = require("../../utils/ApiError");
const profileService = require("./profile.service");

// ─── PATCH /profile ───────────────────────────────────────────────────────────
const update = catchAsync(async (req, res) => {
  const { name, email, avatarUrl, cars, addresses, paymentMethods, favoriteBrands, lastName, gender, dob } = req.body;
  const updated = await profileService.updateProfile(
    req.tenantDb,
    req.user.id,
    { name, email, avatarUrl, cars, addresses, paymentMethods, favoriteBrands, lastName, gender, dob },
    req.tenantId,
  );
  res.json({ success: true, user: updated });
});

// ─── DELETE /profile ──────────────────────────────────────────────────────────
const remove = catchAsync(async (req, res) => {
  const result = await profileService.deleteAccount(req.tenantDb, req.user.id);
  res.json({ success: true, ...result });
});

// ─── POST /profile/address/upload-doorstep ────────────────────────────────────
const uploadDoorstepImages = catchAsync(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No doorstep image files provided");
  }

  const images = req.files.map((file) => ({
    imageUrl: `/uploads/doorsteps/${file.filename}`,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
  }));

  res.status(201).json({ success: true, data: images });
});

// ─── POST /profile/address/delete-doorstep ────────────────────────────────────
const deleteDoorstepImages = catchAsync(async (req, res) => {
  const { imageUrls } = req.body;
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    const fs = require("fs");
    const path = require("path");
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "../../../uploads");

    imageUrls.forEach((imgUrl) => {
      if (typeof imgUrl === "string" && imgUrl.includes("/uploads/doorsteps/")) {
        const filename = path.basename(imgUrl);
        const filePath = path.join(uploadDir, "doorsteps", filename);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error("Failed to delete doorstep image file:", filePath, e);
          }
        }
      }
    });
  }
  res.json({ success: true });
});

module.exports = { update, remove, uploadDoorstepImages, deleteDoorstepImages, uploadAvatar };

