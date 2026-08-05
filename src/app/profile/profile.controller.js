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

module.exports = { update, remove, uploadDoorstepImages };
