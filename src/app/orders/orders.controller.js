/**
 * App Orders Controller
 *
 * POST /orders            → place a new order
 * GET  /orders            → my order history (paginated)
 * GET  /orders/:orderId   → single order detail
 */

const catchAsync = require("../../utils/catchAsync");
const ordersService = require("./orders.service");

// ─── POST /orders ─────────────────────────────────────────────────────────────
const place = catchAsync(async (req, res) => {
  const order = await ordersService.placeOrder(
    req.tenantDb,
    req.user.id,
    req.body,
    req.tenantId,
    req.tenant
  );
  res.status(201).json({ success: true, data: order });
});

const placePublic = catchAsync(async (req, res) => {
  const order = await ordersService.placeOrder(
    req.tenantDb,
    null, // guest order
    req.body,
    req.tenantId,
    req.tenant
  );
  // Emit to Socket.io so cashier POS receives instantly
  const io = req.app.get("io");
  if (io) {
    io.to(`branch:${order.branchId}`).emit("order:new", order);
  }
  res.status(201).json({ success: true, data: order });
});

// ─── GET /orders ──────────────────────────────────────────────────────────────
const myOrders = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50); // cap at 50
  const result = await ordersService.getMyOrders(req.tenantDb, req.user.id, { page, limit });
  res.json({ success: true, ...result });
});

// ─── GET /orders/:orderId ─────────────────────────────────────────────────────
const getOne = catchAsync(async (req, res) => {
  const order = await ordersService.getOrder(req.tenantDb, req.params.orderId, req.user.id);
  res.json({ success: true, data: order });
});

// ─── POST /orders/:orderId/pay ────────────────────────────────────────────────
const payOrder = catchAsync(async (req, res) => {
  const order = await ordersService.payHaltedOrder(req.params.orderId, req.user.id);
  res.json({ success: true, data: order });
});

// ─── POST /orders/:orderId/notify-arrived ─────────────────────────────────────
const notifyArrived = catchAsync(async (req, res) => {
  const io = req.app.get("io");
  const result = await ordersService.notifyArrived(
    req.tenantDb,
    req.params.orderId,
    req.user.id,
    io
  );
  res.json({ success: true, ...result });
});

module.exports = { place, placePublic, myOrders, getOne, payOrder, notifyArrived };
