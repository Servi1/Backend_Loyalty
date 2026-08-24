const catchAsync = require("../../../utils/catchAsync");
const kdsDevicesService = require("./kds-devices.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const devices = await kdsDevicesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: devices });
});

const create = catchAsync(async (req, res) => {
  const device = await kdsDevicesService.create(req.tenantDb, req.body, req.tenant.cycleKds || "monthly");
  
  // Sync kdsQuantity in main database if registered count exceeds quota
  const count = await req.tenantDb.kdsDevice.count({});
  if (count > (req.tenant.kdsQuantity || 0)) {
    const mainPrisma = require("../../../config/prisma");
    await mainPrisma.tenant.update({
      where: { id: req.tenant.id },
      data: { kdsQuantity: count }
    }).catch(() => null);
  }

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
