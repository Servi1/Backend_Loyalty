const catchAsync = require("../../../utils/catchAsync");
const productRequestsService = require("./product-requests.service");

const getAll = catchAsync(async (req, res) => {
  const { branchId, status, warehouseId } = req.query;
  const requests = await productRequestsService.getAll(req.tenantDb, { branchId, status, warehouseId });
  res.json({ success: true, data: requests });
});

const create = catchAsync(async (req, res) => {
  // If branchId is not provided, use the logged-in staff member's branchId
  const branchId = req.body.branchId || req.user.branchId;
  const data = { ...req.body, branchId };

  const request = await productRequestsService.create(req.tenantDb, data);
  res.status(201).json({ success: true, data: request });
});

const updateStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  const request = await productRequestsService.updateStatus(req.tenantDb, req.params.id, status);
  res.json({ success: true, data: request });
});

const remove = catchAsync(async (req, res) => {
  await productRequestsService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  updateStatus,
  remove
};
