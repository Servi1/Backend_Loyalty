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
        paymentMethod: order.paymentMethod || "cash",
        pointsRedeemed: order.pointsRedeemed || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      update: {
        status: order.status,
        total: order.total,
        notes: order.notes,
        feeRate: order.feeRate || 0.0,
        paymentMethod: order.paymentMethod || "cash",
        pointsRedeemed: order.pointsRedeemed || null,
        updatedAt: order.updatedAt,
      },
    });
  } catch (err) {
    console.error("[APP] Failed to sync order to super admin DB:", err.message);
  }
};

// ─── placeOrder ───────────────────────────────────────────────────────────────

const placeOrder = async (db, userId, body, tenantId, tenant) => {
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

  // Verify tenant subscription active feature flags
  if (tenant) {
    if (isDineIn && tenant.subQrTable === false) {
      throw new ApiError(403, "QR Table Dining ordering is currently deactivated for this brand. Please contact restaurant staff.");
    }
    if (!isDineIn && tenant.subQrCashier === false) {
      throw new ApiError(403, "QR Cashier takeaway ordering is currently deactivated for this brand. Please contact restaurant staff.");
    }
  }

  if (isDineIn && branch.tablesEnabled === false) {
    throw new ApiError(403, "Table ordering is currently disabled for this branch.");
  }
  if (tableId) {
    const table = await db.table.findUnique({ where: { id: tableId } });
    if (!table) throw new ApiError(404, "Table not found");
    if (!table.isActive) {
      throw new ApiError(403, "This table is currently inactive. Please contact restaurant staff.");
    }
    if (table.expiresAt && new Date(table.expiresAt) < new Date()) {
      throw new ApiError(403, "Table ordering subscription is expired. Please contact restaurant staff.");
    }
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
    
    let modifiersPrice = 0;
    if (item.selectedModifiers && Array.isArray(item.selectedModifiers)) {
      item.selectedModifiers.forEach((mod) => {
        if (mod.options && Array.isArray(mod.options)) {
          mod.options.forEach((opt) => {
            modifiersPrice += Number(opt.priceModifier || 0);
          });
        }
      });
    }

    const itemPrice = menuItem.price + modifiersPrice;
    const lineTotal = itemPrice * (item.quantity || 1);
    subtotal += lineTotal;
    
    return {
      menuItemId: item.menuItemId,
      quantity: item.quantity || 1,
      price: itemPrice,
      notes: item.notes || null,
      selectedModifiers: item.selectedModifiers || [],
    };
  });

  if (typeof total === "number" && Math.abs(total - subtotal) > 0.01) {
    console.warn(
      `[APP ORDER] Client total mismatch: client=${total}, server=${subtotal}. Using server total.`
    );
  }

  const orderNumber = generateOrderNumber();
  let finalNotes = notes || null;
  let pointsRedeemed = null;

  if (paymentMethod === "points") {
    const pointsCost = Math.round(subtotal * 100);
    const wallet = await loyaltyService.getWallet(db, userId);
    if (!wallet || wallet.points < pointsCost) {
      throw new ApiError(400, "Insufficient points to complete this order");
    }
    pointsRedeemed = pointsCost;
    // Redeem points — link transaction to this order so the wallet history shows the order number
    await loyaltyService.redeemPoints(
      db,
      userId,
      pointsCost,
      `Points redeemed for Order #${orderNumber}`,
      tenantId,
      { orderId: null, orderNumber } // orderId filled after order creation below
    );
    finalNotes = finalNotes ? `${finalNotes} | Points Payment` : "Points Payment";
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
      paymentMethod: paymentMethod || "cash",
      pointsRedeemed: pointsRedeemed,
      items: { create: orderItems },
    },
    include: {
      items: { include: { menuItem: true } },
      branch: true,
      table: true,
    },
  });

  // Now back-fill orderId on the wallet transaction we created above
  if (paymentMethod === "points" && userId) {
    try {
      await require("../../config/prisma").walletTransaction.updateMany({
        where: { orderNumber, walletId: { not: undefined } },
        data: { orderId: order.id },
      });
    } catch (err) {
      console.warn("[APP ORDER] Could not back-fill orderId on wallet transaction:", err.message);
    }
  }

  let user = null;
  if (userId) {
    user = await mainPrisma.appUser.findUnique({ where: { id: userId } });
  }
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
        paymentMethod: paymentMethod || "cash",
        pointsRedeemed: pointsRedeemed,
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
