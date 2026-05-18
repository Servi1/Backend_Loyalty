const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getAll(req.tenantDb);
  res.json({ success: true, data: branches });
});

const getById = catchAsync(async (req, res) => {
  const branch = await branchesService.getById(req.tenantDb, req.params.id);
  res.json({ success: true, data: branch });
});

const create = catchAsync(async (req, res) => {
  const branch = await branchesService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: branch });
});

const update = catchAsync(async (req, res) => {
  const branch = await branchesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: branch });
});

const remove = catchAsync(async (req, res) => {
  await branchesService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = { getAll, getById, create, update, remove };
