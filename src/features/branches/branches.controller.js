const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");

const getByTenant = catchAsync(async (req, res) => {
  const branches = await branchesService.getByTenant(req.tenantId);
  res.json({ success: true, data: branches });
});

const getById = catchAsync(async (req, res) => {
  const branch = await branchesService.getById(req.params.id);
  res.json({ success: true, data: branch });
});

const create = catchAsync(async (req, res) => {
  const branch = await branchesService.create({ ...req.body, tenantId: req.tenantId });
  res.status(201).json({ success: true, data: branch });
});

const update = catchAsync(async (req, res) => {
  const branch = await branchesService.update(req.params.id, req.body);
  res.json({ success: true, data: branch });
});

const remove = catchAsync(async (req, res) => {
  await branchesService.remove(req.params.id);
  res.status(204).send();
});

module.exports = { getByTenant, getById, create, update, remove };
