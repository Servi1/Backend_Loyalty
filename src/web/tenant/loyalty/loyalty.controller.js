const catchAsync = require("../../../utils/catchAsync");
const loyaltyService = require("./loyalty.service");
const mainPrisma = require("../../../config/prisma");

const getWallet = catchAsync(async (req, res) => {
  const wallet = await loyaltyService.getWallet(req.tenantDb, req.user.id);
  res.json({ success: true, data: wallet });
});

const earn = catchAsync(async (req, res) => {
  const customerId = req.body.customerId || req.body.userId;
  const { points, description } = req.body;
  const wallet = await loyaltyService.earnPoints(req.tenantDb, customerId, points, description, req.tenantId);
  res.json({ success: true, data: wallet });
});

const redeem = catchAsync(async (req, res) => {
  const targetCustomerId = ((req.body.customerId || req.body.userId) && ["ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"].includes(req.user.role))
    ? (req.body.customerId || req.body.userId)
    : req.user.id;
  const wallet = await loyaltyService.redeemPoints(req.tenantDb, targetCustomerId, req.body.points, req.body.description, req.tenantId);
  res.json({ success: true, data: wallet });
});

const searchCustomers = catchAsync(async (req, res) => {
  const customers = await loyaltyService.searchCustomers(req.tenantDb, req.query.search);
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: req.tenantId } });
  res.json({
    success: true,
    data: customers,
    config: {
      loyaltyEnabled: tenant?.loyaltyEnabled ?? false,
      loyaltyEarnRate: tenant?.loyaltyEarnRate ?? 1.0,
      loyaltyRedeemRate: tenant?.loyaltyRedeemRate ?? 100.0,
    }
  });
});

const getAllCustomers = catchAsync(async (req, res) => {
  const customers = await loyaltyService.getAllCustomersForReport(req.tenantDb, req.tenantId);
  res.json({ success: true, data: customers });
});

const getAllTransactions = catchAsync(async (req, res) => {
  const transactions = await loyaltyService.getAllTransactionsForReport(req.tenantDb, req.tenantId);
  res.json({ success: true, data: transactions });
});

const createCustomer = catchAsync(async (req, res) => {
  const customer = await loyaltyService.createCustomer(req.tenantDb, req.body, req.tenantId);
  res.status(201).json({ success: true, data: customer });
});

const getTiers = catchAsync(async (req, res) => {
  const tiers = await loyaltyService.getTiers(req.tenantId);
  res.json({ success: true, data: tiers });
});

const updateTiers = catchAsync(async (req, res) => {
  const tiers = await loyaltyService.updateTiers(req.tenantId, req.body.tiers);
  res.json({ success: true, data: tiers });
});

module.exports = { 
  getWallet, 
  earn, 
  redeem, 
  searchCustomers, 
  getAllCustomers, 
  getAllTransactions,
  createCustomer,
  getTiers,
  updateTiers,
};
