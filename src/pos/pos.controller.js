const catchAsync = require("../utils/catchAsync");
const posService = require("./pos.service");

/** GET /api/pos/catalog */
const getCatalog = catchAsync(async (req, res) => {
  const catalog = await posService.getCatalog(req.tenantDb);
  res.status(200).json({ success: true, data: catalog });
});

/** GET /api/pos/tables */
const getTables = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const tables = await posService.getTables(req.tenantDb, branchId);
  res.status(200).json({ success: true, data: tables });
});

/** GET /api/pos/orders */
const getOrders = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const { status } = req.query;
  const orders = await posService.getOrders(req.tenantDb, branchId, status);
  res.status(200).json({ success: true, data: orders });
});

/** POST /api/pos/orders */
const createOrder = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const userId = req.user.id;
  const order = await posService.createOrder(req.tenantDb, branchId, userId, req.body, req.tenantId);
  res.status(201).json({ success: true, data: order });
});

/** PATCH /api/pos/orders/:id/status */
const updateOrderStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status, paymentMethod } = req.body;
  const order = await posService.updateOrderStatus(req.tenantDb, id, status, req.tenantId, paymentMethod);
  res.status(200).json({ success: true, data: order });
});

const getEODReport = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const { date } = req.query; // expect YYYY-MM-DD
  const report = await posService.getEODReport(req.tenantDb, branchId, date);
  res.status(200).json({ success: true, data: report });
});

const downloadEODReportPDF = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const { date } = req.query; // expect YYYY-MM-DD
  const report = await posService.getEODReport(req.tenantDb, branchId, date);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=EOD-Report-${date}.pdf`);

  await posService.generateEODReportPDF(report, req.user, res);
});

const getCashDrawerStatus = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const session = await posService.getCurrentCashDrawerSession(req.tenantDb, branchId);
  res.status(200).json({ success: true, data: session });
});

const openCashDrawer = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const userId = req.user.id;
  const { openingBalance } = req.body;
  const session = await posService.openCashDrawerSession(req.tenantDb, branchId, userId, openingBalance);
  res.status(201).json({ success: true, data: session });
});

const closeCashDrawer = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { sessionId, actualEndingBalance, cashCounts } = req.body;
  const session = await posService.closeCashDrawerSession(req.tenantDb, sessionId, userId, actualEndingBalance, cashCounts);
  res.status(200).json({ success: true, data: session });
});

const getCashDrawerSessions = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const sessions = await posService.getCashDrawerSessions(req.tenantDb, branchId);
  res.status(200).json({ success: true, data: sessions });
});

module.exports = {
  getCatalog,
  getTables,
  getOrders,
  createOrder,
  updateOrderStatus,
  getEODReport,
  downloadEODReportPDF,
  getCashDrawerStatus,
  openCashDrawer,
  closeCashDrawer,
  getCashDrawerSessions
};
