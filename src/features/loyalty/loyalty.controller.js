const catchAsync = require("../../utils/catchAsync");
const loyaltyService = require("./loyalty.service");

const getWallet = catchAsync(async (req, res) => {
  const wallet = await loyaltyService.getWallet(req.tenantDb, req.user.id);
  res.json({ success: true, data: wallet });
});

const earn = catchAsync(async (req, res) => {
  const { userId, points, description } = req.body;
  const wallet = await loyaltyService.earnPoints(req.tenantDb, userId, points, description, req.tenantId);
  res.json({ success: true, data: wallet });
});

const redeem = catchAsync(async (req, res) => {
  const targetUserId = (req.body.userId && ["ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"].includes(req.user.role))
    ? req.body.userId
    : req.user.id;
  const wallet = await loyaltyService.redeemPoints(req.tenantDb, targetUserId, req.body.points, req.body.description, req.tenantId);
  res.json({ success: true, data: wallet });
});

const searchCustomers = catchAsync(async (req, res) => {
  const customers = await loyaltyService.searchCustomers(req.tenantDb, req.query.search);
  res.json({ success: true, data: customers });
});

module.exports = { getWallet, earn, redeem, searchCustomers };
