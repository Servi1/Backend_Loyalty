const ApiError = require("../../../utils/ApiError");
const crypto = require("crypto");
const mainPrisma = require("../../../config/prisma");

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

  const finalTotal = typeof total === "number" ? total : subtotal;

  const order = await db.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      customerId: userId,
      branchId,
      tableId: tableId || null,
      type: type || "DINE_IN",
      notes,
      total: finalTotal,
      items: { create: orderItems },
    },
    include: { items: { include: { menuItem: true } }, branch: true },
  });

  if (userId) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: userId } });
    order.user = user;
  }

  // Sync to super admin aggregated orders asynchronously
  syncToAggregatedOrder(db, tenantId, order).catch(console.error);

  return order;
};

const getByBranch = async (db, branchId, status, startDate, endDate) => {
  const where = { branchId };
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  const orders = await db.order.findMany({
    where,
    include: { items: { include: { menuItem: true } }, table: true },
    orderBy: { createdAt: "desc" },
  });

  const customerIds = [...new Set(orders.map(o => o.customerId).filter(Boolean))];
  const users = await mainPrisma.appUser.findMany({
    where: { id: { in: customerIds } }
  });

  orders.forEach(o => {
    o.user = users.find(u => u.id === o.customerId) || null;
  });

  return orders;
};

const getByUser = async (db, userId) =>
  db.order.findMany({
    where: { customerId: userId },
    include: { items: { include: { menuItem: true } }, branch: true },
    orderBy: { createdAt: "desc" },
  });

const updateStatus = async (db, id, status, tenantId, notes) => {
  const order = await db.order.findUnique({ where: { id } });
  if (!order) throw new ApiError(404, "Order not found");

  const updateData = { status };
  if (notes !== undefined) {
    updateData.notes = notes;
  }

  const updated = await db.order.update({
    where: { id },
    data: updateData,
    include: { items: { include: { menuItem: true } }, table: true, branch: true }
  });

  if (updated.customerId) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: updated.customerId } });
    updated.user = user;
  }

  if (status === "COMPLETED" && updated.customerId) {
    if (updated.notes && updated.notes.includes("Paid by Loyalty Points")) {
      syncToAggregatedOrder(db, tenantId, updated).catch(console.error);
      return updated;
    }

    try {
      const wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: updated.customerId } });
      if (wallet) {
        const description = `Earned on Order #${updated.orderNumber}`;
        const alreadyEarned = await mainPrisma.walletTransaction.findFirst({
          where: {
            walletId: wallet.id,
            description,
          }
        });

        if (!alreadyEarned) {
          const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
          const earnRate = tenant ? tenant.loyaltyEarnRate : 1.0;
          const pointsToEarn = Math.floor(updated.total * earnRate);
          if (pointsToEarn > 0) {
            await mainPrisma.wallet.update({
              where: { appUserId: updated.customerId },
              data: {
                points: { increment: pointsToEarn },
                lifetimeEarn: { increment: pointsToEarn },
              }
            });
            await mainPrisma.walletTransaction.create({
              data: {
                walletId: wallet.id,
                points: pointsToEarn,
                description,
                tenantId: tenantId || null,
              }
            });
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
  const orders = await db.order.findMany({
    where,
    include: { items: { include: { menuItem: true } }, table: true, branch: true },
    orderBy: { createdAt: "desc" },
  });

  const customerIds = [...new Set(orders.map(o => o.customerId).filter(Boolean))];
  const users = await mainPrisma.appUser.findMany({
    where: { id: { in: customerIds } }
  });

  orders.forEach(o => {
    o.user = users.find(u => u.id === o.customerId) || null;
  });

  return orders;
};

module.exports = { create, getByBranch, getByUser, updateStatus, getAll };
