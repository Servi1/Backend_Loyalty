const catchAsync = require("../../../utils/catchAsync");
const ordersService = require("./orders.service");
const ApiError = require("../../../utils/ApiError");

const create = catchAsync(async (req, res) => {
  if (req.user && req.user.role === "CASHIER" && req.user.branch && req.user.branch.posEnabled === false) {
    throw new ApiError(403, "POS terminal access is currently disabled for this branch.");
  }

  const isCustomer = req.user.role === "CUSTOMER";
  const userId = isCustomer ? null : req.user.id;
  const customerId = isCustomer ? req.user.id : req.body.customerId;

  const order = await ordersService.create(
    req.tenantDb,
    { userId, customerId, ...req.body },
    req.tenantId
  );
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
  const isCustomer = req.user.role === "CUSTOMER";
  const orders = isCustomer
    ? await ordersService.getByCustomer(req.tenantDb, req.user.id)
    : await ordersService.getByUser(req.tenantDb, req.user.id);
  res.json({ success: true, data: orders });
});

const updateStatus = catchAsync(async (req, res) => {
  if (req.user && req.user.role === "CASHIER" && req.user.branch && req.user.branch.posEnabled === false) {
    throw new ApiError(403, "POS terminal access is currently disabled for this branch.");
  }

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
