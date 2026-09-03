const catchAsync = require("../../../utils/catchAsync");
const branchesService = require("./branches.service");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getAll(req.tenantDb);
  res.json({ success: true, data: branches });
});

const getById = catchAsync(async (req, res) => {
  const branch = await branchesService.getById(req.tenantDb, req.params.id);
  res.json({ success: true, data: branch });
});

const create = catchAsync(async (req, res) => {
  const limit = req.tenant.branchLimit || 5;
  const currentCount = await req.tenantDb.branch.count();
  if (currentCount >= limit) {
    throw new ApiError(400, `You have reached the maximum limit of ${limit} branch(es) for your subscription.`);
  }

  const branch = await branchesService.create(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: branch });
});

const mainPrisma = require("../../../config/prisma");

const update = catchAsync(async (req, res) => {
  const userRole = (req.user?.role || "").toUpperCase();
  const isSuperAdmin = userRole === "SUPER_ADMIN" || userRole === "SUPER_ADMINISTRATOR";

  if (isSuperAdmin && req.tenant?.id) {
    const tenantUpdateData = {};
    if (req.body.posEnabled !== undefined) tenantUpdateData.subPos = Boolean(req.body.posEnabled);
    if (req.body.tablesEnabled !== undefined) tenantUpdateData.subQrTable = Boolean(req.body.tablesEnabled);
    if (req.body.qrEnabled !== undefined) tenantUpdateData.subQrCashier = Boolean(req.body.qrEnabled);
    if (req.body.kdsEnabled !== undefined) tenantUpdateData.subKds = Boolean(req.body.kdsEnabled);
    if (req.body.cdsEnabled !== undefined) tenantUpdateData.subCds = Boolean(req.body.cdsEnabled);
    if (req.body.appServiEnabled !== undefined) tenantUpdateData.subAppServi = Boolean(req.body.appServiEnabled);

    if (Object.keys(tenantUpdateData).length > 0) {
      await mainPrisma.tenant.update({
        where: { id: req.tenant.id },
        data: tenantUpdateData
      });
    }
  } else if (!isSuperAdmin) {
    if (req.body.posEnabled === true && req.tenant?.subPos === false) {
      throw new ApiError(403, "POS feature is disabled in Super Admin Subscriptions.");
    }
    if (req.body.tablesEnabled === true && req.tenant?.subQrTable === false) {
      throw new ApiError(403, "Tables feature is disabled in Super Admin Subscriptions.");
    }
    if (req.body.qrEnabled === true && req.tenant?.subQrCashier === false) {
      throw new ApiError(403, "QR Cashier feature is disabled in Super Admin Subscriptions.");
    }
    if (req.body.kdsEnabled === true && req.tenant?.subKds === false) {
      throw new ApiError(403, "KDS feature is disabled in Super Admin Subscriptions.");
    }
    if (req.body.cdsEnabled === true && req.tenant?.subCds === false) {
      throw new ApiError(403, "CDS feature is disabled in Super Admin Subscriptions.");
    }
    if (req.body.appServiEnabled === true && req.tenant?.subAppServi === false) {
      throw new ApiError(403, "App Servi feature is disabled in Super Admin Subscriptions.");
    }
  }

  const branch = await branchesService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: branch });
});

const remove = catchAsync(async (req, res) => {
  throw new ApiError(400, "Branch deletion is disabled to prevent orphaning order records.");
});

const bulkUpdate = catchAsync(async (req, res) => {
  const { ids, data } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "Branch IDs array 'ids' is required.");
  }
  const result = await branchesService.bulkUpdate(req.tenantDb, ids, data);
  res.json({ success: true, count: result.count });
});

module.exports = { getAll, getById, create, update, remove, bulkUpdate };
