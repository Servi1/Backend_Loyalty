const catchAsync = require("../../../utils/catchAsync");
const tablesService = require("./tables.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const tables = await tablesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: tables });
});

const create = catchAsync(async (req, res) => {
  const limit = req.tenant.qrTableQuantity || 10;
  const currentCount = await req.tenantDb.table.count({
    where: { branchId: req.body.branchId }
  });
  
  if (currentCount >= limit) {
    throw new ApiError(400, `You have reached the limit of ${limit} QR tables for this branch.`);
  }

  const table = await tablesService.create(req.tenantDb, req.body, req.tenant.cycleQrTable);
  res.status(201).json({ success: true, data: table });
});

const renewTable = catchAsync(async (req, res) => {
  const table = await tablesService.renew(req.tenantDb, req.params.id, req.tenant.cycleQrTable);
  res.json({ success: true, data: table });
});

const remove = catchAsync(async (req, res) => {
  throw new ApiError(400, "Table deletion is disabled to prevent database inconsistency.");
});

const update = catchAsync(async (req, res) => {
  const table = await tablesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: table });
});

module.exports = {
  getAll,
  create,
  renewTable,
  remove,
  update,
};
