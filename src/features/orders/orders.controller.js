const catchAsync = require("../../utils/catchAsync");
const ordersService = require("./orders.service");

const create = catchAsync(async (req, res) => {
  const order = await ordersService.create({ userId: req.user.id, ...req.body });
  // Emit to Socket.io so cashier POS receives instantly
  const io = req.app.get("io");
  if (io) {
    io.to(`branch:${order.branchId}`).emit("order:new", order);
  }
  res.status(201).json({ success: true, data: order });
});

const getByBranch = catchAsync(async (req, res) => {
  const orders = await ordersService.getByBranch(req.params.branchId, req.query.status);
  res.json({ success: true, data: orders });
});

const getMyOrders = catchAsync(async (req, res) => {
  const orders = await ordersService.getByUser(req.user.id);
  res.json({ success: true, data: orders });
});

const updateStatus = catchAsync(async (req, res) => {
  const order = await ordersService.updateStatus(req.params.id, req.body.status);
  // Notify via socket
  const io = req.app.get("io");
  if (io) {
    io.to(`branch:${order.branchId}`).emit("order:updated", order);
    io.to(`user:${order.userId}`).emit("order:status", order);
  }
  res.json({ success: true, data: order });
});

module.exports = { create, getByBranch, getMyOrders, updateStatus };
