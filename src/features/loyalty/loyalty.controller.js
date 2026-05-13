const catchAsync = require("../../utils/catchAsync");
const loyaltyService = require("./loyalty.service");

const getWallet = catchAsync(async (req, res) => {
  const wallet = await loyaltyService.getWallet(req.user.id);
  res.json({ success: true, data: wallet });
});

const earn = catchAsync(async (req, res) => {
  const { userId, points, description } = req.body;
  const wallet = await loyaltyService.earnPoints(userId, points, description);
  res.json({ success: true, data: wallet });
});

const redeem = catchAsync(async (req, res) => {
  const wallet = await loyaltyService.redeemPoints(req.user.id, req.body.points, req.body.description);
  res.json({ success: true, data: wallet });
});

module.exports = { getWallet, earn, redeem };
