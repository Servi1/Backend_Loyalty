const catchAsync = require("../../utils/catchAsync");
const tenantsService = require("./tenants.service");

const getAll = catchAsync(async (_req, res) => {
  const tenants = await tenantsService.getAll();
  res.json({ success: true, data: tenants });
});

const getById = catchAsync(async (req, res) => {
  const tenant = await tenantsService.getById(req.params.id);
  res.json({ success: true, data: tenant });
});

const create = catchAsync(async (req, res) => {
  const tenant = await tenantsService.create(req.body);
  res.status(201).json({ success: true, data: tenant });
});

const update = catchAsync(async (req, res) => {
  const tenant = await tenantsService.update(req.params.id, req.body);
  res.json({ success: true, data: tenant });
});

const remove = catchAsync(async (req, res) => {
  await tenantsService.remove(req.params.id);
  res.status(204).send();
});

module.exports = { getAll, getById, create, update, remove };
