/**
 * App Profile Controller
 *
 * PATCH /profile      → update name / email / avatar
 * DELETE /profile     → anonymise / delete account
 */

const catchAsync = require("../../utils/catchAsync");
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

module.exports = { update, remove };
