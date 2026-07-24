const catchAsync = require("../../utils/catchAsync");
const walletService = require("./wallet.service");

// ─── GET /wallet ──────────────────────────────────────────────────────────────
const getWallet = catchAsync(async (req, res) => {
  const wallet = await walletService.getWallet(req.tenantDb, req.user.id);
  res.json({ success: true, data: wallet });
});

// ─── GET /wallet/transactions ─────────────────────────────────────────────────
const getTransactions = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const result = await walletService.getTransactions(req.tenantDb, req.user.id, { page, limit });
  res.json({ success: true, ...result });
});

// ─── POST /wallet/transfer ───────────────────────────────────────────────────
const transferPoints = catchAsync(async (req, res) => {
  const { recipientPhone, points, message } = req.body;
  const result = await walletService.transferPoints(req.tenantDb, req.tenantId, req.user.id, {
    recipientPhone,
    points: parseInt(points),
    message
  });
  res.json({ success: true, message: "Points transferred successfully", data: result });
});

// ─── GET /wallet/gifts ────────────────────────────────────────────────────────
const getGifts = catchAsync(async (req, res) => {
  const gifts = await walletService.getGifts(req.tenantDb, req.user.id);
  res.json({ success: true, data: gifts });
});

// ─── POST /wallet/gifts/:giftId/claim ──────────────────────────────────────────
const claimGift = catchAsync(async (req, res) => {
  const result = await walletService.claimGift(req.tenantDb, req.tenantId, req.user.id, req.params.giftId);
  res.json({ success: true, message: "Gift claimed successfully", data: result });
});

// ─── POST /wallet/gifts/claim-all ──────────────────────────────────────────────
const claimAllGifts = catchAsync(async (req, res) => {
  const result = await walletService.claimAllGifts(req.tenantDb, req.tenantId, req.user.id);
  res.json({ success: true, message: "All gifts claimed successfully", data: result });
});

// ─── GET /wallet/leaderboard ──────────────────────────────────────────────────
const getLeaderboard = catchAsync(async (req, res) => {
  const result = await walletService.getLeaderboard(req.tenantDb);
  res.json({ success: true, data: result });
});

// ─── GET /wallet/coupons ──────────────────────────────────────────────────────
const getCoupons = catchAsync(async (req, res) => {
  const coupons = await walletService.getCoupons(req.tenantDb, req.user.id);
  res.json({ success: true, data: coupons });
});

// ─── POST /wallet/coupons ─────────────────────────────────────────────────────
const addCoupon = catchAsync(async (req, res) => {
  const { prizeLabel, prizeImageUrl, code, expiresAt } = req.body;
  const coupon = await walletService.addCoupon(req.tenantDb, req.user.id, {
    prizeLabel,
    prizeImageUrl,
    code,
    expiresAt,
  });
  res.json({ success: true, message: "Coupon saved successfully", data: coupon });
});

module.exports = {
  getWallet,
  getTransactions,
  transferPoints,
  getLeaderboard,
  getGifts,
  claimGift,
  claimAllGifts,
  getCoupons,
  addCoupon,
};
