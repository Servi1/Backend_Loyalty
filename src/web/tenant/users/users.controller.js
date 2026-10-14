const catchAsync = require("../../../utils/catchAsync");
const usersService = require("./users.service");

const getAll = catchAsync(async (req, res) => {
  const { branchId, startDate, endDate, includeBrandManager } = req.query;
  const isSuperAdmin = req.user?.role?.toLowerCase() === "super_admin" || req.user?.role === "SUPER_ADMIN" || !!req.admin;
  const shouldIncludeBrandManager = includeBrandManager === "true" || isSuperAdmin;
  const staff = await usersService.getAllStaff(req.tenantDb, branchId, startDate, endDate, shouldIncludeBrandManager);
  res.json({ success: true, data: staff });
});

const create = catchAsync(async (req, res) => {
  const staff = await usersService.createStaff(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: staff });
});

const remove = catchAsync(async (req, res) => {
  await usersService.removeStaff(req.tenantDb, req.params.id, req.user);
  res.status(204).send();
});

const update = catchAsync(async (req, res) => {
  const staff = await usersService.updateStaff(req.tenantDb, req.params.id, req.body, req.user);
  res.json({ success: true, data: staff });
});

module.exports = {
  getAll,
  create,
  remove,
  update,
};
