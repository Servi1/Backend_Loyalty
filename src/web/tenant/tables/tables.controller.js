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

  const io = req.app.get("io");
  if (io) {
    const tenantId = req.tenant?.id || req.tenantId;
    const tenantSlug = req.tenant?.slug;
    const payload = { tableId: table.id, id: table.id, branchId: table.branchId, tenantId, table };
    if (table.branchId) io.to(`branch:${table.branchId}`).emit("table:created", payload);
    if (tenantId) io.to(`tenant:${tenantId}`).emit("table:created", payload);
    if (tenantSlug && tenantSlug !== tenantId) io.to(`tenant:${tenantSlug}`).emit("table:created", payload);
  }

  res.status(201).json({ success: true, data: table });
});

const renewTable = catchAsync(async (req, res) => {
  const table = await tablesService.renew(req.tenantDb, req.params.id, req.tenant.cycleQrTable);

  const io = req.app.get("io");
  if (io) {
    const tenantId = req.tenant?.id || req.tenantId;
    const tenantSlug = req.tenant?.slug;
    const payload = { tableId: table.id, id: table.id, branchId: table.branchId, tenantId, table };
    if (table.branchId) io.to(`branch:${table.branchId}`).emit("table:updated", payload);
    if (tenantId) io.to(`tenant:${tenantId}`).emit("table:updated", payload);
    if (tenantSlug && tenantSlug !== tenantId) io.to(`tenant:${tenantSlug}`).emit("table:updated", payload);
  }

  res.json({ success: true, data: table });
});

const remove = catchAsync(async (req, res) => {
  throw new ApiError(400, "Table deletion is disabled to prevent database inconsistency.");
});

const update = catchAsync(async (req, res) => {
  const table = await tablesService.update(req.tenantDb, req.params.id, req.body);

  // Real-time socket emission to Brand Admin and Branch Manager
  const io = req.app.get("io");
  if (io) {
    const tenantId = req.tenant?.id || req.tenantId;
    const tenantSlug = req.tenant?.slug;
    const payload = {
      tableId: table.id,
      id: table.id,
      status: table.status,
      isActive: table.isActive,
      seats: table.seats,
      label: table.label,
      zone: table.zone,
      branchId: table.branchId,
      tenantId,
      table,
    };
    if (table.branchId) {
      io.to(`branch:${table.branchId}`).emit("table:status_changed", payload);
      io.to(`branch:${table.branchId}`).emit("table:updated", payload);
    }
    if (tenantId) {
      io.to(`tenant:${tenantId}`).emit("table:status_changed", payload);
      io.to(`tenant:${tenantId}`).emit("table:updated", payload);
    }
    if (tenantSlug && tenantSlug !== tenantId) {
      io.to(`tenant:${tenantSlug}`).emit("table:status_changed", payload);
      io.to(`tenant:${tenantSlug}`).emit("table:updated", payload);
    }
  }

  res.json({ success: true, data: table });
});

module.exports = {
  getAll,
  create,
  renewTable,
  remove,
  update,
};
