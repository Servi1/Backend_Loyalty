const catchAsync = require("../utils/catchAsync");
const kdsService = require("./kds.service");

/** GET /api/kds/orders */
const getOrders = catchAsync(async (req, res) => {
  const branchId = req.user.branchId;
  const result = await kdsService.getKdsOrders(req.tenantDb, branchId);
  res.status(200).json({ success: true, data: result });
});

/** PATCH /api/kds/orders/:id/bump */
const bumpOrder = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await kdsService.bumpOrder(req.tenantDb, id, req.tenantId);
  res.status(200).json({ success: true, data: result });
});

/** PATCH /api/kds/orders/:id/recall */
const recallOrder = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await kdsService.recallOrder(req.tenantDb, id, req.tenantId);
  res.status(200).json({ success: true, data: result });
});

module.exports = {
  getOrders,
  bumpOrder,
  recallOrder
};
