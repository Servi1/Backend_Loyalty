const catchAsync = require("../../../utils/catchAsync");
const kdsDevicesService = require("./kds-devices.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const devices = await kdsDevicesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: devices });
});

const create = catchAsync(async (req, res) => {
  if (req.tenant?.subKds === false) {
    throw new ApiError(403, "KDS feature is deactivated for your subscription.");
  }
  const limit = req.tenant.kdsQuantity !== undefined && req.tenant.kdsQuantity !== null ? Number(req.tenant.kdsQuantity) : 0;
  if (limit > 0) {
    const currentCount = await req.tenantDb.kdsDevice.count({});
    if (currentCount >= limit) {
      throw new ApiError(400, `You have reached the maximum limit of ${limit} KDS screen(s) for your subscription. Please purchase additional KDS licenses in Brand Market.`);
    }
  }

  const device = await kdsDevicesService.create(req.tenantDb, req.body, req.tenant.cycleKds || "monthly");

  res.status(201).json({ success: true, data: device });
});

const renewKds = catchAsync(async (req, res) => {
  const device = await kdsDevicesService.renew(req.tenantDb, req.params.id, req.tenant.cycleKds || "monthly");
  res.json({ success: true, data: device });
});

const remove = catchAsync(async (req, res) => {
  throw new ApiError(400, "KDS device deletion is disabled to prevent database inconsistency.");
});

const update = catchAsync(async (req, res) => {
  const device = await kdsDevicesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: device });
});

module.exports = {
  getAll,
  create,
  renewKds,
  remove,
  update,
};
