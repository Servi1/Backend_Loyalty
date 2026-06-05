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

module.exports = { getWallet, getTransactions, transferPoints };
