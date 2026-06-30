const catchAsync = require("../../../utils/catchAsync");
const qrCashiersService = require("./qr-cashiers.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const qrCashiers = await qrCashiersService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: qrCashiers });
});

const create = catchAsync(async (req, res) => {
  const limit = req.tenant.qrCashierQuantity || 10;
  
  const currentCount = await req.tenantDb.qrCashier.count({
    where: { branchId: req.body.branchId }
  });
  
  if (currentCount >= limit) {
    throw new ApiError(400, `You have reached the limit of ${limit} QR Cashiers for this branch.`);
  }

  const qrCashier = await qrCashiersService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: qrCashier });
});

const remove = catchAsync(async (req, res) => {
  await qrCashiersService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

const update = catchAsync(async (req, res) => {
  const qrCashier = await qrCashiersService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: qrCashier });
});

module.exports = {
  getAll,
  create,
  remove,
  update,
};
