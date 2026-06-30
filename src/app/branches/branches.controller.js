const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getBranches(req.tenantDb);
  const data = branches.map(branch => ({
    ...branch,
    tenantFeatures: {
      subQrTable: req.tenant.subQrTable,
      subQrCashier: req.tenant.subQrCashier,
      subPos: req.tenant.subPos,
      subKds: req.tenant.subKds,
      subCds: req.tenant.subCds
    }
  }));
  res.json({ success: true, data });
});

const getOne = catchAsync(async (req, res) => {
  const branch = await branchesService.getBranch(req.tenantDb, req.params.branchId);
  res.json({ 
    success: true, 
    data: {
      ...branch,
      tenantFeatures: {
        subQrTable: req.tenant.subQrTable,
        subQrCashier: req.tenant.subQrCashier,
        subPos: req.tenant.subPos,
        subKds: req.tenant.subKds,
        subCds: req.tenant.subCds
      }
    } 
  });
});

module.exports = { getAll, getOne };
