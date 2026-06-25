const ApiError = require("../../../utils/ApiError");
const crypto = require("crypto");
const mainPrisma = require("../../../config/prisma");

const syncToAggregatedOrder = async (db, tenantId, order) => {
  if (!tenantId) return;
  try {
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
        branchName: branch?.name || "Register Terminal",
        feeRate: order.feeRate || 0.0,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      update: {
        status: order.status,
        total: order.total,
        notes: order.notes,
        customerName,
        branchName: branch?.name || "Register Terminal",
        feeRate: order.feeRate || 0.0,
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

const create = async (db, { userId, customerId, branchId, tableId, type, items, notes, total, posUnit }, tenantId) => {
  if (tableId) {
    const table = await db.table.findUnique({ where: { id: tableId } });
    if (table) {
      if (!table.isActive) {
        throw new ApiError(400, "This table is currently inactive.");
      }
      if (table.expiresAt && new Date(table.expiresAt) < new Date()) {
        throw new ApiError(400, "Table ordering subscription is expired. Please renew.");
      }
    }
  }

  if (posUnit) {
    const pos = await db.posDevice.findUnique({ where: { deviceKey: posUnit } });
    if (pos) {
      if (!pos.isActive) {
        throw new ApiError(400, "This POS device is currently inactive.");
      }
      if (pos.expiresAt && new Date(pos.expiresAt) < new Date()) {
        throw new ApiError(400, "POS terminal subscription is expired. Please renew.");
      }
    }
  }

  // Calculate total from items
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await db.menuItem.findMany({ where: { id: { in: menuItemIds } } });

  let subtotal = 0;
  const orderItems = items.map((item) => {
    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
    if (!menuItem) throw new ApiError(400, `Menu item ${item.menuItemId} not found`);
    
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

  // Use the passed total if provided; otherwise fall back to subtotal
  const finalTotal = typeof total === "number" ? total : subtotal;

  // Look up fee percentage from main database
  let feeRate = 0.0;
  if (tenantId) {
    try {
      const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        if (userId) {
          feeRate = tenant.feePos ?? 0.0;
        } else if (tableId) {
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
      orderNumber: generateOrderNumber(),
      userId: userId || null,
      customerId: customerId || null,
      branchId,
      tableId: tableId || null,
      type: type || "DINE_IN",
      notes,
      total: finalTotal,
      feeRate,
      posUnit: posUnit || null,
      items: { create: orderItems },
    },
    include: { items: { include: { menuItem: true } }, branch: true },
  });

  if (userId) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: userId } });
    order.user = user;
  }

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
        posUnit: order.posUnit,
        appUserId: order.customerId || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      }
    });
  } catch (err) {
    console.error("[TENANT ORDER] Failed to create main database order:", err.message);
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

const getByCustomer = async (db, customerId) =>
  db.order.findMany({
    where: { customerId },
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

  // Sync status update to main database
  try {
    const mainOrderExists = await mainPrisma.order.findUnique({ where: { id } });
    if (mainOrderExists) {
      await mainPrisma.order.update({
        where: { id },
        data: {
          status,
          ...(notes !== undefined && { notes }),
          updatedAt: updated.updatedAt,
        }
      });
    }
  } catch (err) {
    console.error("[TENANT ORDER] Failed to update main database order status:", err.message);
  }

  if (updated.customerId) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: updated.customerId } });
    updated.user = user;
  }

  if (status === "COMPLETED" && updated.customerId) {
    // Do not award points if paid using loyalty points
    if (updated.notes && updated.notes.includes("Paid by Loyalty Points")) {
      syncToAggregatedOrder(db, tenantId, updated).catch(console.error);
      return updated;
    }

    try {
      const customer = await mainPrisma.appUser.findUnique({
        where: { id: updated.customerId },
        include: { wallet: true }
      });
      if (customer && customer.wallet) {
        const description = `Earned on Order #${updated.orderNumber}`;
        const tx = await mainPrisma.walletTransaction.findFirst({
          where: {
            walletId: customer.wallet.id,
            description,
          }
        });

        if (!tx) {
          const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
          const earnRate = tenant ? tenant.loyaltyEarnRate : 1.0;
          const pointsToEarn = Math.floor(updated.total * earnRate);
          if (pointsToEarn > 0) {
            const loyaltyService = require("../loyalty/loyalty.service");
            await loyaltyService.earnPoints(db, updated.customerId, pointsToEarn, description, tenantId);
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

module.exports = { create, getByBranch, getByUser, getByCustomer, updateStatus, getAll };
