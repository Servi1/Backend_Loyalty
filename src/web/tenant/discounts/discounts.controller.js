const catchAsync = require("../../../utils/catchAsync");
const discountsService = require("./discounts.service");

const getAll = catchAsync(async (req, res) => {
  const discounts = await discountsService.getAll(req.tenantDb);
  res.json({ success: true, data: discounts });
});

const create = catchAsync(async (req, res) => {
  const discount = await discountsService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: discount });
});

const update = catchAsync(async (req, res) => {
  const discount = await discountsService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: discount });
});

const remove = catchAsync(async (req, res) => {
  await discountsService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove
};
