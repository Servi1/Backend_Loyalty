const catchAsync = require("../../utils/catchAsync");
const usersService = require("./users.service");

const getAll = catchAsync(async (req, res) => {
  const { branchId, startDate, endDate } = req.query;
  const staff = await usersService.getAllStaff(req.tenantDb, branchId, startDate, endDate);
  res.json({ success: true, data: staff });
});

const create = catchAsync(async (req, res) => {
  const staff = await usersService.createStaff(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: staff });
});

const remove = catchAsync(async (req, res) => {
  await usersService.removeStaff(req.tenantDb, req.params.id);
  res.status(204).send();
});

module.exports = {
  getAll,
  create,
  remove,
};
