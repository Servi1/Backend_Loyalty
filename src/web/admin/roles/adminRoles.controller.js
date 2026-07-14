const catchAsync = require("../../../utils/catchAsync");
const service = require("./adminRoles.service");

const getAll = catchAsync(async (req, res) => {
  const roles = await service.getAll();
  res.status(200).json({ success: true, data: roles });
});

const create = catchAsync(async (req, res) => {
  const role = await service.create(req.body);
  res.status(201).json({ success: true, data: role });
});

const update = catchAsync(async (req, res) => {
  const role = await service.update(req.params.id, req.body);
  res.status(200).json({ success: true, data: role });
});

const remove = catchAsync(async (req, res) => {
  const result = await service.remove(req.params.id);
  res.status(200).json({ success: true, ...result });
});

module.exports = {
  getAll,
  create,
  update,
  remove
};
