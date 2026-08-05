const catchAsync = require("../../../utils/catchAsync");
const globalOrderTypesService = require("./globalOrderTypes.service");

const getAll = catchAsync(async (req, res) => {
  const list = await globalOrderTypesService.getAll();
  res.json({ success: true, data: list });
});

const create = catchAsync(async (req, res) => {
  const item = await globalOrderTypesService.create(req.body);
  res.status(201).json({ success: true, data: item });
});

const update = catchAsync(async (req, res) => {
  const item = await globalOrderTypesService.update(req.params.id, req.body);
  res.json({ success: true, data: item });
});

const remove = catchAsync(async (req, res) => {
  await globalOrderTypesService.remove(req.params.id);
  res.json({ success: true, message: "Order Type deleted successfully" });
});

module.exports = {
  getAll,
  create,
  update,
  remove
};
