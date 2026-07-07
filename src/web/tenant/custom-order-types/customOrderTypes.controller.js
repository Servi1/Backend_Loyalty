const catchAsync = require("../../../utils/catchAsync");
const customOrderTypesService = require("./customOrderTypes.service");

const getAll = catchAsync(async (req, res) => {
  const orderTypes = await customOrderTypesService.getAll(req.tenantDb);
  res.json({ success: true, data: orderTypes });
});

const create = catchAsync(async (req, res) => {
  const orderType = await customOrderTypesService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: orderType });
});

const update = catchAsync(async (req, res) => {
  const orderType = await customOrderTypesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: orderType });
});

const remove = catchAsync(async (req, res) => {
  await customOrderTypesService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove,
};
