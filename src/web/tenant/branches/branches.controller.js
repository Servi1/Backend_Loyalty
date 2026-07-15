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

const update = catchAsync(async (req, res) => {
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
