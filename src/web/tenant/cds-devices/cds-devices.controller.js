const catchAsync = require("../../../utils/catchAsync");
const cdsDevicesService = require("./cds-devices.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const devices = await cdsDevicesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: devices });
});

const create = catchAsync(async (req, res) => {
  if (req.tenant?.subCds === false) {
    throw new ApiError(403, "CDS feature is deactivated for your subscription.");
  }
  const limit = req.tenant.cdsQuantity !== undefined && req.tenant.cdsQuantity !== null ? Number(req.tenant.cdsQuantity) : 0;
  if (limit > 0) {
    const currentCount = await req.tenantDb.cdsDevice.count({}).catch(() => 0);
    if (currentCount >= limit) {
      throw new ApiError(400, `You have reached the maximum limit of ${limit} CDS screen(s) for your subscription. Please purchase additional CDS licenses in Brand Market.`);
    }
  }

  const device = await cdsDevicesService.create(req.tenantDb, req.body, req.tenant.cycleCds || "monthly");

  res.status(201).json({ success: true, data: device });
});

const renewCds = catchAsync(async (req, res) => {
  const device = await cdsDevicesService.renew(req.tenantDb, req.params.id, req.tenant.cycleCds || "monthly");
  res.json({ success: true, data: device });
});

const remove = catchAsync(async (req, res) => {
  const device = await cdsDevicesService.remove(req.tenantDb, req.params.id);
  res.json({ success: true, data: device });
});

const update = catchAsync(async (req, res) => {
  const device = await cdsDevicesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: device });
});

module.exports = {
  getAll,
  create,
  renewCds,
  remove,
  update,
};

