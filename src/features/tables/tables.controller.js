const catchAsync = require("../../utils/catchAsync");
const tablesService = require("./tables.service");

const getAll = catchAsync(async (req, res) => {
  const tables = await tablesService.getAll(req.tenantDb);
  res.json({ success: true, data: tables });
});

const create = catchAsync(async (req, res) => {
  const table = await tablesService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: table });
});

const remove = catchAsync(async (req, res) => {
  await tablesService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  remove,
};
