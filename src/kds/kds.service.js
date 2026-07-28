const ApiError = require("../utils/ApiError");

/**
 * Map DB Order to KDS format.
 */
const mapDbOrderToKds = (order) => {
  // Determine station based on items category
  let station = "kitchen";
  if (order.items && order.items.length > 0) {
    const categories = order.items.map(i => i.menuItem?.category?.name?.toLowerCase() || "");
    if (categories.some(c => c.includes("drink") || c.includes("beverage"))) {
      station = "drinks";
    } else if (categories.some(c => c.includes("dessert") || c.includes("sweet"))) {
      station = "desserts";
    }
  }

  // Parse table number
  let tableNumber = 0;
  if (order.table && order.table.label) {
    const num = parseInt(order.table.label.replace(/\D/g, ""), 10);
    if (!isNaN(num)) tableNumber = num;
  }

  // Map order type
  let orderType = "Dine In";
  if (order.type === "TAKEAWAY") orderType = "Takeaway";
  else if (order.type === "DELIVERY") orderType = "Delivery";

  // Map status
  let status = "new";
  if (order.status === "PREPARING") status = "preparing";
  else if (order.status === "READY") status = "ready";

  const customerName = order.customerName || (order.user?.name || "Walk-in");

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    tableNumber,
    orderType,
    customerName,
    status,
    createdAt: new Date(order.createdAt).getTime(),
    elapsedTime: Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000),
    station,
    items: (order.items || []).map(item => ({
      id: item.id,
      name: item.menuItem?.name || "Unknown Item",
      quantity: item.quantity,
      details: item.notes || ""
    }))
  };
};

/**
 * Fetch all KDS orders (active and completed) for a branch.
 */
const getKdsOrders = async (db, branchId) => {
  // Fetch active: PENDING, ACCEPTED, PREPARING
  // Fetch completed (in KDS terms: READY)
  const orders = await db.order.findMany({
    where: {
      branchId,
      status: {
        in: ["PENDING", "ACCEPTED", "PREPARING", "READY"]
      }
    },
    include: {
      items: {
        include: {
          menuItem: {
            include: { category: true }
          }
        }
      },
      table: true,
      user: true
    },
    orderBy: { createdAt: "asc" }
  });

  const kdsOrders = orders.map(mapDbOrderToKds);

  return {
    activeOrders: kdsOrders.filter(o => o.status === "new" || o.status === "preparing"),
    completedOrders: kdsOrders.filter(o => o.status === "ready")
  };
};

const syncToAggregatedOrder = async (db, tenantId, order) => {
  if (!tenantId) return;
  try {
    const mainPrisma = require("../config/prisma");
    let customerName = "Customer Walk-in";
    if (order.customerId) {
      const customer = await mainPrisma.appUser.findUnique({ where: { id: order.customerId } });
      if (customer) {
        customerName = customer.name || customer.phone || "Customer Walk-in";
      }
    } else if (order.userId) {
      const user = await db.user.findUnique({ where: { id: order.userId } });
      if (user) {
        customerName = user.name || user.phone || "Customer Walk-in";
      }
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
        customerName,
        customerPhone: order.customerPhone || null,
        branchName: branch?.name || "Register Terminal",
        feeRate: order.feeRate || 0.0,
        source: order.source || "pos",
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      update: {
        status: order.status,
        total: order.total,
        notes: order.notes,
        customerName,
        customerPhone: order.customerPhone || null,
        branchName: branch?.name || "Register Terminal",
        feeRate: order.feeRate || 0.0,
        source: order.source || "pos",
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        updatedAt: order.updatedAt,
      }
    });
  } catch (err) {
    console.error("Failed to sync order to super admin database:", err.message);
  }
};

/**
 * Bump an order (status -> READY).
 */
const bumpOrder = async (db, orderId, tenantId) => {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  const updated = await db.order.update({
    where: { id: orderId },
    data: { status: "READY" },
    include: {
      items: {
        include: {
          menuItem: {
            include: { category: true }
          }
        }
      },
      table: true,
      user: true
    }
  });

  // Sync status update to main database if it exists
  try {
    const mainPrisma = require("../config/prisma");
    const mainOrderExists = await mainPrisma.order.findUnique({ where: { id: orderId } });
    if (mainOrderExists) {
      await mainPrisma.order.update({
        where: { id: orderId },
        data: {
          status: "READY",
          updatedAt: updated.updatedAt,
        }
      });
    }
  } catch (err) {
    console.error("[KDS BUMP] Failed to update main database order status:", err.message);
  }

  // Sync status to main aggregatedOrder
  syncToAggregatedOrder(db, tenantId, updated).catch(console.error);

  return mapDbOrderToKds(updated);
};

/**
 * Recall an order (status -> PREPARING).
 */
const recallOrder = async (db, orderId, tenantId) => {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  const updated = await db.order.update({
    where: { id: orderId },
    data: { status: "PREPARING" },
    include: {
      items: {
        include: {
          menuItem: {
            include: { category: true }
          }
        }
      },
      table: true,
      user: true
    }
  });

  // Sync status update to main database if it exists
  try {
    const mainPrisma = require("../config/prisma");
    const mainOrderExists = await mainPrisma.order.findUnique({ where: { id: orderId } });
    if (mainOrderExists) {
      await mainPrisma.order.update({
        where: { id: orderId },
        data: {
          status: "PREPARING",
          updatedAt: updated.updatedAt,
        }
      });
    }
  } catch (err) {
    console.error("[KDS RECALL] Failed to update main database order status:", err.message);
  }

  // Sync status to main aggregatedOrder
  syncToAggregatedOrder(db, tenantId, updated).catch(console.error);

  return mapDbOrderToKds(updated);
};

module.exports = {
  getKdsOrders,
  bumpOrder,
  recallOrder
};
