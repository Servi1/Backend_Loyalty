const catchAsync = require("../../../utils/catchAsync");
const pagersService = require("./pagers.service");
const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const getAll = catchAsync(async (req, res) => {
  let branchId = req.query.branchId;
  // If user is restricted to a branch, enforce branch scope
  if (req.user?.branchId) {
    branchId = req.user.branchId;
  }
  const pagers = await pagersService.getAll(req.tenantDb, branchId);
  res.json({ success: true, data: pagers });
});

const getById = catchAsync(async (req, res) => {
  const pager = await pagersService.getById(req.tenantDb, req.params.id);
  if (req.user?.branchId && pager.branchId !== req.user.branchId) {
    throw new ApiError(403, "Access denied to this branch pager");
  }
  res.json({ success: true, data: pager });
});

const create = catchAsync(async (req, res) => {
  if (req.user?.branchId && req.body.branchId !== req.user.branchId) {
    throw new ApiError(403, "You can only create pagers for your assigned branch");
  }
  const pager = await pagersService.create(req.tenantDb, req.tenant, req.body);
  res.status(201).json({ success: true, data: pager });
});

const renew = catchAsync(async (req, res) => {
  const pager = await pagersService.renew(req.tenantDb, req.params.id, req.tenant.cyclePager);
  res.json({ success: true, data: pager });
});

const update = catchAsync(async (req, res) => {
  const pager = await pagersService.update(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: pager });
});

const getTickets = catchAsync(async (req, res) => {
  const pager = await pagersService.getById(req.tenantDb, req.params.id);
  if (req.user?.branchId && pager.branchId !== req.user.branchId) {
    throw new ApiError(403, "Access denied to this branch pager tickets");
  }
  const filter = req.query.filter || "active";
  const tickets = await pagersService.getTickets(req.tenantDb, req.params.id, filter);
  res.json({ success: true, data: tickets });
});

const updateTicketStatus = catchAsync(async (req, res) => {
  const pager = await pagersService.getById(req.tenantDb, req.params.id);
  if (req.user?.branchId && pager.branchId !== req.user.branchId) {
    throw new ApiError(403, "Access denied to update tickets in this branch");
  }
  const io = req.app.get("io");
  const ticket = await pagersService.updateTicketStatus(
    req.tenantDb,
    mainPrisma,
    req.params.id,
    req.params.ticketId,
    req.body,
    req.tenant,
    io
  );
  res.json({ success: true, data: ticket });
});

const getActiveOrders = catchAsync(async (req, res) => {
  const pager = await pagersService.getById(req.tenantDb, req.params.id);
  const orders = await pagersService.getBranchActiveOrders(req.tenantDb, pager.branchId);
  res.json({ success: true, data: orders });
});

module.exports = {
  getAll,
  getById,
  create,
  renew,
  update,
  getTickets,
  updateTicketStatus,
  getActiveOrders,
};

