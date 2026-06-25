const catchAsync = require("../../../utils/catchAsync");
const posDevicesService = require("./pos-devices.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const devices = await posDevicesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: devices });
});

const create = catchAsync(async (req, res) => {
  // Check POS quantity limit per branch from main registry
  const limit = req.tenant.posQuantity || 1;
  const currentCount = await req.tenantDb.posDevice.count({
    where: { branchId: req.body.branchId }
  });
  
  if (currentCount >= limit) {
    throw new ApiError(400, `You have reached the limit of ${limit} POS terminals for this branch.`);
  }

  const device = await posDevicesService.create(req.tenantDb, req.body, req.tenant.cyclePos);
  res.status(201).json({ success: true, data: device });
});

const renewPos = catchAsync(async (req, res) => {
  const device = await posDevicesService.renew(req.tenantDb, req.params.id, req.tenant.cyclePos);
  res.json({ success: true, data: device });
});

const remove = catchAsync(async (req, res) => {
  await posDevicesService.remove(req.tenantDb, req.params.id);
  res.status(204).send();
});

const update = catchAsync(async (req, res) => {
  const device = await posDevicesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: device });
});

module.exports = {
  getAll,
  create,
  renewPos,
  remove,
  update,
};
