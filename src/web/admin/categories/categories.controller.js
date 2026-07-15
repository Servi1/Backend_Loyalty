const catchAsync = require("../../../utils/catchAsync");
const service = require("./categories.service");

const getAll = catchAsync(async (req, res) => {
  const categories = await service.getAll();
  res.status(200).json({ success: true, data: categories });
});

const create = catchAsync(async (req, res) => {
  const category = await service.create(req.body);
  res.status(201).json({ success: true, data: category });
});

const update = catchAsync(async (req, res) => {
  const category = await service.update(req.params.id, req.body);
  res.status(200).json({ success: true, data: category });
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
