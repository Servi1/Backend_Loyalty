const catchAsync = require("../../../utils/catchAsync");
const tablesService = require("./tables.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const tables = await tablesService.getAll(req.tenantDb, req.query.branchId);
  res.json({ success: true, data: tables });
});

const create = catchAsync(async (req, res) => {
  const table = await tablesService.create(req.tenantDb, req.body, req.tenant.cycleQrTable);
  
  // Sync qrTableQuantity in main database if registered count exceeds quota
  const count = await req.tenantDb.table.count({});
  if (count > (req.tenant.qrTableQuantity || 0)) {
    const mainPrisma = require("../../../config/prisma");
    await mainPrisma.tenant.update({
      where: { id: req.tenant.id },
      data: { qrTableQuantity: count }
    }).catch(() => null);
  }

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
