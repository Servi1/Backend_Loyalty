const catchAsync = require("../../../utils/catchAsync");
const locationGroupsService = require("./locationGroups.service");

const getAll = catchAsync(async (req, res) => {
  const groups = await locationGroupsService.getAll(req.tenantDb);
  res.json({ success: true, data: groups });
});

const create = catchAsync(async (req, res) => {
  const group = await locationGroupsService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: group });
});

const update = catchAsync(async (req, res) => {
  const group = await locationGroupsService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: group });
});

const remove = catchAsync(async (req, res) => {
  await locationGroupsService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove,
};
