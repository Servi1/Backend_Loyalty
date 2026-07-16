const catchAsync = require("../../../utils/catchAsync");
const warehousesService = require("./warehouses.service");

const getAll = catchAsync(async (req, res) => {
  const warehouses = await warehousesService.getAll(req.tenantDb);
  res.json({ success: true, data: warehouses });
});

const create = catchAsync(async (req, res) => {
  const warehouse = await warehousesService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: warehouse });
});

const update = catchAsync(async (req, res) => {
  const warehouse = await warehousesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: warehouse });
});

const remove = catchAsync(async (req, res) => {
  await warehousesService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove
};
