const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getBranches(req.tenantDb);
  res.json({ success: true, data: branches });
});

const getOne = catchAsync(async (req, res) => {
  const branch = await branchesService.getBranch(req.tenantDb, req.params.branchId);
  res.json({ success: true, data: branch });
});

module.exports = { getAll, getOne };
