const catchAsync = require("../../../utils/catchAsync");
const posDevicesService = require("./pos-devices.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const devices = await posDevicesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: devices });
});

const create = catchAsync(async (req, res) => {
  if (req.tenant?.subPos === false) {
    throw new ApiError(403, "POS terminal feature is deactivated for your subscription.");
  }
  const limit = req.tenant.posQuantity !== undefined && req.tenant.posQuantity !== null ? Number(req.tenant.posQuantity) : 0;
  if (limit > 0) {
    const currentCount = await req.tenantDb.posDevice.count({});
    if (currentCount >= limit) {
      throw new ApiError(400, `You have reached the maximum limit of ${limit} POS terminal(s) for your subscription. Please purchase additional POS licenses in Brand Market.`);
    }
  }

  const device = await posDevicesService.create(req.tenantDb, req.body, req.tenant.cyclePos);

  res.status(201).json({ success: true, data: device });
});

const renewPos = catchAsync(async (req, res) => {
  const device = await posDevicesService.renew(req.tenantDb, req.params.id, req.tenant.cyclePos);
  res.json({ success: true, data: device });
});

const remove = catchAsync(async (req, res) => {
  throw new ApiError(400, "POS device deletion is disabled to prevent database inconsistency.");
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
