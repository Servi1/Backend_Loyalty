const ApiError = require("../../utils/ApiError");
const crypto = require("crypto");
const mainPrisma = require("../../config/prisma");
const { syncToAggregatedCustomer } = require("../customers/customers.service");

const syncToAggregatedOrder = async (db, tenantId, order) => {
  if (!tenantId) return;
  try {
    let user = order.user;
    if (!user && order.userId) {
      user = await db.user.findUnique({ where: { id: order.userId } });
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
        customerName: user?.name || user?.phone || "Customer Walk-in",
        branchName: branch?.name || "Register Terminal",
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      update: {
        status: order.status,
        total: order.total,
        notes: order.notes,
        customerName: user?.name || user?.phone || "Customer Walk-in",
        branchName: branch?.name || "Register Terminal",
        updatedAt: order.updatedAt,
      }
    });
  } catch (err) {
    console.error("Failed to sync order to super admin database:", err.message);
  }
};

/**
 * Generate a short order number like "SRV-A3F8K2".
 */
const generateOrderNumber = () => {
  const hex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `SRV-${hex}`;
};

const create = async (db, { userId, branchId, tableId, type, items, notes, total }, tenantId) => {
  // Calculate total from items
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await db.menuItem.findMany({ where: { id: { in: menuItemIds } } });

  let subtotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
    if (!menuItem) throw new ApiError(400, `Menu item ${item.menuItemId} not found`);
    const lineTotal = menuItem.price * (item.quantity || 1);
    subtotal += lineTotal;
    return { menuItemId: item.menuItemId, quantity: item.quantity || 1, price: menuItem.price, notes: item.notes };
  });

  // Use the passed total (which includes tax and discount) if provided; otherwise fall back to subtotal
  const finalTotal = typeof total === "number" ? total : subtotal;

  const order = await db.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      userId,
      branchId,
      tableId: tableId || null,
      type: type || "DINE_IN",
      notes,
      total: finalTotal,
      items: { create: orderItems },
    },
    include: { items: { include: { menuItem: true } }, user: true, branch: true },
  });

  // Sync to super admin aggregated orders asynchronously
  syncToAggregatedOrder(db, tenantId, order).catch(console.error);

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

const updateStatus = async (db, id, status, tenantId) => {
  const order = await db.order.findUnique({ where: { id } });
  if (!order) throw new ApiError(404, "Order not found");
  const updated = await db.order.update({
    where: { id },
    data: { status },
    include: { items: { include: { menuItem: true } }, user: true, table: true, branch: true }
  });

  if (status === "COMPLETED" && updated.user && updated.user.role === "CUSTOMER") {
    // Do not award points if paid using loyalty points
    if (updated.notes && updated.notes.includes("Paid by Loyalty Points")) {
      // Sync to super admin aggregated orders asynchronously and return
      syncToAggregatedOrder(db, tenantId, updated).catch(console.error);
      return updated;
    }

    try {
      const wallet = await db.wallet.findUnique({ where: { userId: updated.userId } });
      if (wallet) {
        const description = `Earned on Order #${updated.orderNumber}`;
        const alreadyEarned = await db.walletTransaction.findFirst({
          where: {
            walletId: wallet.id,
            description,
          }
        });

        if (!alreadyEarned) {
          const pointsToEarn = Math.floor(updated.total);
          if (pointsToEarn > 0) {
            await db.wallet.update({
              where: { userId: updated.userId },
              data: {
                points: { increment: pointsToEarn },
                lifetimeEarn: { increment: pointsToEarn },
              }
            });
            await db.walletTransaction.create({
              data: {
                walletId: wallet.id,
                points: pointsToEarn,
                description,
              }
            });

            if (tenantId) {
              await syncToAggregatedCustomer(db, tenantId, updated.userId);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to auto-award points on order completion:", err.message);
    }
  }

  // Sync to super admin aggregated orders asynchronously
  syncToAggregatedOrder(db, tenantId, updated).catch(console.error);

  return updated;
};

const getAll = async (db, status) => {
  const where = {};
  if (status) where.status = status;
  return db.order.findMany({
    where,
    include: { items: { include: { menuItem: true } }, user: true, table: true, branch: true },
    orderBy: { createdAt: "desc" },
  });
};

module.exports = { create, getByBranch, getByUser, updateStatus, getAll };
