const catchAsync = require("../../../utils/catchAsync");
const service = require("./adminUsers.service");

const getAll = catchAsync(async (req, res) => {
  const users = await service.getAll();
  res.status(200).json({ success: true, data: users });
});

const create = catchAsync(async (req, res) => {
  const user = await service.create(req.body);
  res.status(201).json({ success: true, data: user });
});

const update = catchAsync(async (req, res) => {
  const user = await service.update(req.params.id, req.body);
  res.status(200).json({ success: true, data: user });
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
