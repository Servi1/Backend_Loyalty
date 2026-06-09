/**
 * App Brands Controller
 */

const catchAsync = require("../../utils/catchAsync");
const brandsService = require("./brands.service");

// GET /
const getBrands = catchAsync(async (req, res) => {
  const brands = await brandsService.getBrands(req.user.id);
  res.json({ success: true, data: brands });
});

// POST /:brandId/favorite
const addFavorite = catchAsync(async (req, res) => {
  const { brandId } = req.params;
  const updatedUser = await brandsService.addFavorite(req.user.id, brandId);
  res.json({ success: true, user: updatedUser });
});

// DELETE /:brandId/favorite
const removeFavorite = catchAsync(async (req, res) => {
  const { brandId } = req.params;
  const updatedUser = await brandsService.removeFavorite(req.user.id, brandId);
  res.json({ success: true, user: updatedUser });
});

module.exports = {
  getBrands,
  addFavorite,
  removeFavorite
};
