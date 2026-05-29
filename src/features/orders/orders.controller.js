const catchAsync = require("../../utils/catchAsync");
const ordersService = require("./orders.service");

const create = catchAsync(async (req, res) => {
  const order = await ordersService.create(req.tenantDb, { userId: req.user.id, ...req.body }, req.tenantId);
  // Emit to Socket.io so cashier POS receives instantly
  const io = req.app.get("io");
  if (io) {
    io.to(`branch:${order.branchId}`).emit("order:new", order);
  }
  res.status(201).json({ success: true, data: order });
});

const getByBranch = catchAsync(async (req, res) => {
  const { status, startDate, endDate } = req.query;
  const orders = await ordersService.getByBranch(req.tenantDb, req.params.branchId, status, startDate, endDate);
  res.json({ success: true, data: orders });
});

const getMyOrders = catchAsync(async (req, res) => {
  const orders = await ordersService.getByUser(req.tenantDb, req.user.id);
  res.json({ success: true, data: orders });
});

const updateStatus = catchAsync(async (req, res) => {
  const order = await ordersService.updateStatus(
    req.tenantDb,
    req.params.id,
    req.body.status,
    req.tenantId,
    req.body.notes
  );
  // Notify via socket
  const io = req.app.get("io");
  if (io) {
    io.to(`branch:${order.branchId}`).emit("order:updated", order);
    io.to(`user:${order.userId}`).emit("order:status", order);
  }
  res.json({ success: true, data: order });
});

const getAll = catchAsync(async (req, res) => {
  const orders = await ordersService.getAll(req.tenantDb, req.query.status);
  res.json({ success: true, data: orders });
});

module.exports = { create, getByBranch, getMyOrders, updateStatus, getAll };
