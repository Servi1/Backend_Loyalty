const catchAsync = require("../../utils/catchAsync");
const inventoryService = require("./inventory.service");

const getAll = catchAsync(async (req, res) => {
  const { branchId, startDate, endDate } = req.query;
  const items = await inventoryService.getAll(req.tenantDb, branchId, startDate, endDate);
  res.json({ success: true, data: items });
});

const create = catchAsync(async (req, res) => {
  const item = await inventoryService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: item });
});

const update = catchAsync(async (req, res) => {
  const item = await inventoryService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: item });
});

const remove = catchAsync(async (req, res) => {
  await inventoryService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove
};
