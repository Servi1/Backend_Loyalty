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
  // Emit to Socket.io so cashier POS receives instantly
  try {
    const io = req.app.get("io");
    if (io) {
      io.to(`branch:${order.branchId}`).emit("order:new", order);
      if (order.tableId) {
        const payload = {
          tableId: order.tableId,
          id: order.tableId,
          status: "busy",
          branchId: order.branchId,
          tenantId: req.tenantId,
          orderId: order.id,
        };
        io.to(`branch:${order.branchId}`).emit("table:status_changed", payload);
        io.to(`branch:${order.branchId}`).emit("table:updated", payload);
        if (req.tenantId) {
          io.to(`tenant:${req.tenantId}`).emit("table:status_changed", payload);
          io.to(`tenant:${req.tenantId}`).emit("table:updated", payload);
        }
      }
    }
  } catch (err) {
    console.error("[APP ORDER] Socket emit failed:", err.message);
  }
  // Handle QR Cashier auto-ticket assignment into branch pager
  let pagerId = null;
  let pagerTicket = null;
  const isQrCashierOrder = Boolean(order.qrCashierId || req.body.qrCashierId || req.body.cashierId);
  if (isQrCashierOrder) {
    try {
      const pagersService = require("../../web/tenant/pagers/pagers.service");
      const mainPrisma = require("../../../config/prisma");
      await pagersService.ensureTables(req.tenantDb, mainPrisma);

      // Find active pager device for this branch
      const branchPagers = await req.tenantDb.$queryRawUnsafe(`
        SELECT id, name, "deviceKey", "isActive"
        FROM "PagerDevice"
        WHERE "branchId" = $1 AND "isActive" = true
        ORDER BY "createdAt" ASC
        LIMIT 1
      `, order.branchId).catch(() => []);

      let activePager = branchPagers && branchPagers.length > 0 ? branchPagers[0] : null;

      // Auto-create a default branch pager device if none exists yet and subscription allows
      if (!activePager && req.tenant?.subPager !== false) {
        try {
          activePager = await pagersService.create(req.tenantDb, req.tenant, {
            name: `${order.branch?.name || "Counter"} Pager`,
            branchId: order.branchId,
          });
        } catch (e) {
          // If creation fails (e.g. quota limit reached), activePager remains null
        }
      }

      if (activePager) {
        const io = req.app.get("io");
        const ticketRes = await pagersService.submitCustomerTicket(
          activePager.id,
          {
            phone: order.customerPhone || req.body.customerPhone,
            countryCode: req.body.countryCode || "+966",
            orderNumber: order.orderNumber,
          },
          mainPrisma,
          io
        );
        pagerId = activePager.id;
        pagerTicket = ticketRes?.ticket || null;
      }
    } catch (pagerErr) {
      console.error("[APP ORDER] QR Cashier auto-pager ticket failed:", pagerErr.message);
    }
  }

  res.status(201).json({
    success: true,
    data: {
      ...order,
      pagerId,
      pagerTicket,
    },
  });
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
  try {
    const io = req.app.get("io");
    if (io) {
      io.to(`branch:${order.branchId}`).emit("order:new", order);
      if (order.tableId) {
        const payload = {
          tableId: order.tableId,
          id: order.tableId,
          status: "busy",
          branchId: order.branchId,
          tenantId: req.tenantId,
          orderId: order.id,
        };
        io.to(`branch:${order.branchId}`).emit("table:status_changed", payload);
        io.to(`branch:${order.branchId}`).emit("table:updated", payload);
        if (req.tenantId) {
          io.to(`tenant:${req.tenantId}`).emit("table:status_changed", payload);
          io.to(`tenant:${req.tenantId}`).emit("table:updated", payload);
        }
      }
    }
  } catch (err) {
    console.error("[PUBLIC ORDER] Socket emit failed:", err.message);
  }
  // Handle QR Cashier auto-ticket assignment into branch pager
  let pagerId = null;
  let pagerTicket = null;
  const isQrCashierOrder = Boolean(order.qrCashierId || req.body.qrCashierId || req.body.cashierId);
  if (isQrCashierOrder) {
    try {
      const pagersService = require("../../web/tenant/pagers/pagers.service");
      const mainPrisma = require("../../../config/prisma");
      await pagersService.ensureTables(req.tenantDb, mainPrisma);

      // Find active pager device for this branch
      const branchPagers = await req.tenantDb.$queryRawUnsafe(`
        SELECT id, name, "deviceKey", "isActive"
        FROM "PagerDevice"
        WHERE "branchId" = $1 AND "isActive" = true
        ORDER BY "createdAt" ASC
        LIMIT 1
      `, order.branchId).catch(() => []);

      let activePager = branchPagers && branchPagers.length > 0 ? branchPagers[0] : null;

      // Auto-create a default branch pager device if none exists yet and subscription allows
      if (!activePager && req.tenant?.subPager !== false) {
        try {
          activePager = await pagersService.create(req.tenantDb, req.tenant, {
            name: `${order.branch?.name || "Counter"} Pager`,
            branchId: order.branchId,
          });
        } catch (e) {
          // If creation fails (e.g. quota limit reached), activePager remains null
        }
      }

      if (activePager) {
        const io = req.app.get("io");
        const ticketRes = await pagersService.submitCustomerTicket(
          activePager.id,
          {
            phone: order.customerPhone || req.body.customerPhone,
            countryCode: req.body.countryCode || "+966",
            orderNumber: order.orderNumber,
          },
          mainPrisma,
          io
        );
        pagerId = activePager.id;
        pagerTicket = ticketRes?.ticket || null;
      }
    } catch (pagerErr) {
      console.error("[APP ORDER] QR Cashier auto-pager ticket failed:", pagerErr.message);
    }
  }

  res.status(201).json({
    success: true,
    data: {
      ...order,
      pagerId,
      pagerTicket,
    },
  });
});

// ─── GET /orders ──────────────────────────────────────────────────────────────
const myOrders = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50); // cap at 50
  const tenantId = req.query.tenantId || req.tenantId || null;
  const result = await ordersService.getMyOrders(req.tenantDb, req.user.id, { page, limit, tenantId });
  res.json({ success: true, ...result });
});

// ─── GET /orders/:orderId ─────────────────────────────────────────────────────
const getOne = catchAsync(async (req, res) => {
  const order = await ordersService.getOrder(
    req.tenantDb,
    req.params.orderId,
    req.user.id,
    req.tenantId,
    req.tenant
  );
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

const submitReview = catchAsync(async (req, res) => {
  const order = await ordersService.submitReview(
    req.tenantDb,
    req.params.orderId,
    req.user.id,
    req.body
  );
  res.json({ success: true, data: order });
});

module.exports = { place, placePublic, myOrders, getOne, payOrder, notifyArrived, submitReview };
