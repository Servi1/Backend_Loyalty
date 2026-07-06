const ApiError = require("../utils/ApiError");

/**
 * Fetch all categories and available menu items.
 */
const getCatalog = async (db) => {
  return await db.menuCategory.findMany({
    orderBy: { order: "asc" },
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: { name: "asc" }
      }
    }
  });
};

/**
 * Fetch active service tables for a branch.
 */
const getTables = async (db, branchId) => {
  return await db.table.findMany({
    where: { branchId, isActive: true },
    orderBy: { label: "asc" }
  });
};

/**
 * Fetch orders for a branch, optionally filtered by status.
 */
const getOrders = async (db, branchId, status) => {
  const where = { branchId };
  if (status) {
    where.status = status.toUpperCase();
  }
  return await db.order.findMany({
    where,
    include: {
      items: {
        include: { menuItem: true }
      },
      table: true,
      user: true
    },
    orderBy: { createdAt: "desc" }
  });
};

/**
 * Create a new order with multiple items.
 */
const createOrder = async (db, branchId, userId, orderData) => {
  const { type, total, items, tableId, notes, paymentMethod } = orderData;
  
  if (!items || items.length === 0) {
    throw new ApiError(400, "Order must contain at least one item.");
  }

  // Generate unique order number
  let orderNumber = "";
  let isUnique = false;
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    const suffix = Math.floor(100000 + Math.random() * 900000);
    orderNumber = `ORD-${suffix}`;
    const existing = await db.order.findUnique({ where: { orderNumber } });
    if (!existing) isUnique = true;
    attempts++;
  }

  return await db.order.create({
    data: {
      orderNumber,
      status: "ACCEPTED",
      type: type || "DINE_IN",
      total: Number(total) || 0,
      notes,
      branchId,
      userId,
      tableId,
      paymentMethod: paymentMethod || "cash",
      // optional mobile number from POS client
      customerPhone: orderData.customerPhone || undefined,
      items: {
        create: items.map(item => ({
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          notes: item.notes,
          menuItemId: item.menuItemId,
          selectedModifiers: item.selectedModifiers ? JSON.stringify(item.selectedModifiers) : "[]"
        }))
      }
    },
    include: {
      items: {
        include: { menuItem: true }
      },
      table: true
    }
  });
};

/**
 * Update the status of an existing order.
 */
const updateOrderStatus = async (db, orderId, status) => {
  const validStatuses = ["PENDING", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
  const upperStatus = status.toUpperCase();
  if (!validStatuses.includes(upperStatus)) {
    throw new ApiError(400, `Invalid status value: ${status}`);
  }

  return await db.order.update({
    where: { id: orderId },
    data: { status: upperStatus },
    include: {
      items: {
        include: { menuItem: true }
      },
      table: true
    }
  });
};

module.exports = {
  getCatalog,
  getTables,
  getOrders,
  createOrder,
  updateOrderStatus
};
