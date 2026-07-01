const catchAsync = require("../../../utils/catchAsync");
const couponsService = require("./coupons.service");

const getAll = catchAsync(async (req, res) => {
  const coupons = await couponsService.getAll(req.tenantDb);
  res.json({ success: true, data: coupons });
});

const create = catchAsync(async (req, res) => {
  const coupon = await couponsService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: coupon });
});

const update = catchAsync(async (req, res) => {
  const coupon = await couponsService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: coupon });
});

const remove = catchAsync(async (req, res) => {
  await couponsService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  update,
  remove
};
