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
  const order = await posService.createOrder(req.tenantDb, branchId, userId, req.body);
  res.status(201).json({ success: true, data: order });
});

/** PATCH /api/pos/orders/:id/status */
const updateOrderStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const order = await posService.updateOrderStatus(req.tenantDb, id, status);
  res.status(200).json({ success: true, data: order });
});

module.exports = {
  getCatalog,
  getTables,
  getOrders,
  createOrder,
  updateOrderStatus
};
