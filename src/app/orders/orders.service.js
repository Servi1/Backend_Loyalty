/**
 * App Orders Service
 *
 * placeOrder   — create an order from the app cart
 * getMyOrders  — paginated order history for current customer
 * getOrder     — single order detail
 */

const ApiError = require("../../utils/ApiError");
const crypto = require("crypto");
const mainPrisma = require("../../config/prisma");
const loyaltyService = require("../../web/tenant/loyalty/loyalty.service");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateOrderNumber = () => {
  const hex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `SRV-${hex}`;
};

const syncToAggregatedOrder = async (db, tenantId, order) => {
  if (!tenantId) return;
  try {
    let user = order.user;
    if (!user && order.customerId) {
      user = await mainPrisma.appUser.findUnique({ where: { id: order.customerId } });
    }
    let branch = order.branch;
    if (!branch && order.branchId) {
      branch = await db.branch.findUnique({ where: { id: order.branchId } });
    }

    await mainPrisma.aggregatedOrder.upsert({
      where: { id: `${tenantId}_${order.id}` },
      create: {
        id: `${tenantId}_${order.id}`,
        tenantId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        type: order.type,
        total: order.total,
        notes: order.notes,
        customerName: user?.name || user?.phone || "App Customer",
        branchName: branch?.name || "Unknown",
        feeRate: order.feeRate || 0.0,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      update: {
        status: order.status,
        total: order.total,
        notes: order.notes,
        feeRate: order.feeRate || 0.0,
        updatedAt: order.updatedAt,
      },
    });
  } catch (err) {
    console.error("[APP] Failed to sync order to super admin DB:", err.message);
  }
};

// ─── placeOrder ───────────────────────────────────────────────────────────────

const placeOrder = async (db, userId, body, tenantId) => {
  const { branchId, tableId, type = "DINE_IN", items, notes, total, paymentMethod } = body;

  if (!branchId) throw new ApiError(400, "branchId is required");
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "Order must contain at least one item");
  }

  // Validate branch exists and is open
  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");
  if (!branch.isOpen) throw new ApiError(400, "Branch is currently closed");

  // Validate branch features are enabled for app ordering
  const isDineIn = (type && type.toUpperCase() === "DINE_IN") || !!tableId;
  if (isDineIn && branch.tablesEnabled === false) {
    throw new ApiError(403, "Table ordering is currently disabled for this branch.");
  }
  if (!isDineIn && branch.qrEnabled === false) {
    throw new ApiError(403, "Mobile ordering is currently disabled for this branch.");
  }

  // Validate and price items from the database (never trust client prices)
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: menuItemIds }, isAvailable: true },
  });

  if (menuItems.length !== menuItemIds.length) {
    throw new ApiError(400, "One or more menu items are unavailable or not found");
  }

  let subtotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
    const lineTotal = menuItem.price * (item.quantity || 1);
    subtotal += lineTotal;
    return {
      menuItemId: item.menuItemId,
      quantity: item.quantity || 1,
      price: menuItem.price,
      notes: item.notes || null,
    };
  });

  if (typeof total === "number" && Math.abs(total - subtotal) > 0.01) {
    console.warn(
      `[APP ORDER] Client total mismatch: client=${total}, server=${subtotal}. Using server total.`
    );
  }

  const orderNumber = generateOrderNumber();
  let finalNotes = notes || null;

  if (paymentMethod === "points") {
    const pointsCost = Math.round(subtotal * 100);
    const wallet = await loyaltyService.getWallet(db, userId);
    if (!wallet || wallet.points < pointsCost) {
      throw new ApiError(400, "Insufficient points to complete this order");
    }
    await loyaltyService.redeemPoints(
      db,
      userId,
      pointsCost,
      `Paid by Loyalty Points for Order #${orderNumber}`,
      tenantId
    );
    finalNotes = finalNotes ? `${finalNotes} | Paid by Loyalty Points` : "Paid by Loyalty Points";
  }

  // Look up fee percentage from main database
  let feeRate = 0.0;
  if (tenantId) {
    try {
      const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        if (tableId) {
          feeRate = tenant.feeQrTable ?? 0.0;
        } else if (type === "TAKEAWAY" || type === "DELIVER_TO_CAR") {
          feeRate = tenant.feeQrCashier ?? 0.0;
        } else if (type === "DELIVERY") {
          feeRate = tenant.feeAppBrand ?? 0.0;
        } else {
          feeRate = tenant.feeAppServi ?? 0.0;
        }
      }
    } catch (e) {
      console.error("Failed to query tenant fee settings:", e.message);
    }
  }

  const order = await db.order.create({
    data: {
      orderNumber,
      customerId: userId,
      branchId,
      tableId: tableId || null,
      type,
      notes: finalNotes,
      total: subtotal,
      feeRate,
      items: { create: orderItems },
    },
    include: {
      items: { include: { menuItem: true } },
      branch: true,
      table: true,
    },
  });

  const user = await mainPrisma.appUser.findUnique({ where: { id: userId } });
  order.user = user;

  // Create order in main database
  try {
    await mainPrisma.order.create({
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        type: order.type,
        total: order.total,
        notes: order.notes,
        feeRate: order.feeRate,
        tenantId: tenantId,
        branchId: order.branchId,
        tableId: order.tableId,
        appUserId: userId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      }
    });
  } catch (err) {
    console.error("[APP ORDER] Failed to create order in main database:", err.message);
  }

  // Fire-and-forget — non-blocking side effects
  syncToAggregatedOrder(db, tenantId, order).catch(console.error);

  return order;
};

// ─── getMyOrders ──────────────────────────────────────────────────────────────

const getMyOrders = async (db, userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;

  const [orders, total] = await db.$transaction([
    db.order.findMany({
      where: { customerId: userId },
      include: {
        items: { include: { menuItem: { select: { name: true, price: true } } } },
        branch: { select: { id: true, name: true, address: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.order.count({ where: { customerId: userId } }),
  ]);

  return {
    orders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: skip + limit < total,
    },
  };
};

// ─── getOrder ─────────────────────────────────────────────────────────────────

const getOrder = async (db, orderId, userId) => {
  const order = await db.order.findFirst({
    where: { id: orderId, customerId: userId }, // ensure customer can only see their own orders
    include: {
      items: { include: { menuItem: true } },
      branch: true,
      table: true,
    },
  });
  if (!order) throw new ApiError(404, "Order not found");
  return order;
};

module.exports = { placeOrder, getMyOrders, getOrder };
