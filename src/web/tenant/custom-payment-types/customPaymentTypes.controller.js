const catchAsync = require("../../../utils/catchAsync");
const customPaymentTypesService = require("./customPaymentTypes.service");

const getAll = catchAsync(async (req, res) => {
  const paymentTypes = await customPaymentTypesService.getAll(req.tenantDb);
  res.json({ success: true, data: paymentTypes });
});

const create = catchAsync(async (req, res) => {
  const paymentType = await customPaymentTypesService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: paymentType });
});

const update = catchAsync(async (req, res) => {
  const paymentType = await customPaymentTypesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: paymentType });
});

const remove = catchAsync(async (req, res) => {
  await customPaymentTypesService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove,
};
