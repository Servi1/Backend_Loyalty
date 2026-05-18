const ApiError = require("../../utils/ApiError");
const crypto = require("crypto");

/**
 * Generate a short order number like "SRV-A3F8K2".
 */
const generateOrderNumber = () => {
  const hex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `SRV-${hex}`;
};

const create = async (db, { userId, branchId, tableId, type, items, notes }) => {
  // Calculate total from items
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await db.menuItem.findMany({ where: { id: { in: menuItemIds } } });

  let total = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
    if (!menuItem) throw new ApiError(400, `Menu item ${item.menuItemId} not found`);
    const lineTotal = menuItem.price * (item.quantity || 1);
    total += lineTotal;
    return { menuItemId: item.menuItemId, quantity: item.quantity || 1, price: menuItem.price, notes: item.notes };
  });

  const order = await db.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      userId,
      branchId,
      tableId: tableId || null,
      type: type || "DINE_IN",
      notes,
      total,
      items: { create: orderItems },
    },
    include: { items: { include: { menuItem: true } } },
  });

  return order;
};

const getByBranch = async (db, branchId, status) => {
  const where = { branchId };
  if (status) where.status = status;
  return db.order.findMany({
    where,
    include: { items: { include: { menuItem: true } }, user: true, table: true },
    orderBy: { createdAt: "desc" },
  });
};

const getByUser = async (db, userId) =>
  db.order.findMany({
    where: { userId },
    include: { items: { include: { menuItem: true } }, branch: true },
    orderBy: { createdAt: "desc" },
  });

const updateStatus = async (db, id, status) => {
  const order = await db.order.findUnique({ where: { id } });
  if (!order) throw new ApiError(404, "Order not found");
  return db.order.update({ where: { id }, data: { status } });
};

module.exports = { create, getByBranch, getByUser, updateStatus };
