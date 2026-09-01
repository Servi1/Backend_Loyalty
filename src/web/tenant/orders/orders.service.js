const ApiError = require("../../../utils/ApiError");
const crypto = require("crypto");
const mainPrisma = require("../../../config/prisma");

const resolveTenantFeeRate = (tenant, source) => {
  if (!tenant) return 0.0;
  const src = (source || "pos").toLowerCase();
  if (src === "app") return Number(tenant.feeAppServi !== undefined && tenant.feeAppServi !== null ? tenant.feeAppServi : 0.0);
  if (src === "app_brand") return Number(tenant.feeAppBrand !== undefined && tenant.feeAppBrand !== null ? tenant.feeAppBrand : 0.0);
  if (src === "pos") return Number(tenant.feePos !== undefined && tenant.feePos !== null ? tenant.feePos : 0.0);
  if (src === "qr_table") return Number(tenant.feeQrTable !== undefined && tenant.feeQrTable !== null ? tenant.feeQrTable : 0.0);
  if (src === "qr_cashier") return Number(tenant.feeQrCashier !== undefined && tenant.feeQrCashier !== null ? tenant.feeQrCashier : 0.0);
  if (src === "kds") return Number(tenant.feeKds !== undefined && tenant.feeKds !== null ? tenant.feeKds : 0.0);
  if (src === "cds") return Number(tenant.feeCds !== undefined && tenant.feeCds !== null ? tenant.feeCds : 0.0);
  return 0.0;
};

const syncToAggregatedOrder = async (db, tenantId, order) => {
  if (!tenantId) return;
  try {
    const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    const resolvedFeeRate = (order.feeRate && Number(order.feeRate) > 0) 
      ? Number(order.feeRate) 
      : resolveTenantFeeRate(tenant, order.source);

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
        feeRate: resolvedFeeRate,
        source: order.source || "pos",
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        slotDetails: order.slotDetails || null,
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
        feeRate: resolvedFeeRate,
        source: order.source || "pos",
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        slotDetails: order.slotDetails || null,
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

const isBranchOpenNow = (branch) => {
  if (!branch) return { isOpen: false, reason: "Branch location not found." };
  if (branch.isOpen === false) {
    return { isOpen: false, reason: "Branch is currently marked as closed." };
  }
  if (!branch.openingTime || !branch.closingTime) {
    return { isOpen: true };
  }

  const parseTimeToMinutes = (tStr) => {
    if (!tStr) return 0;
    const parts = tStr.trim().split(" ");
    let [h, m] = parts[0].split(":").map(Number);
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    if (parts[1]) {
      const period = parts[1].toUpperCase();
      if (period === "PM" && h < 12) h += 12;
      if (period === "AM" && h === 12) h = 0;
    }
    return h * 60 + m;
  };

  const openMin = parseTimeToMinutes(branch.openingTime);
  const closeMin = parseTimeToMinutes(branch.closingTime);

  if (openMin === closeMin) return { isOpen: true };

  const now = new Date();
  const saudiTimeStr = now.toLocaleTimeString("en-US", { timeZone: branch.timezone || "Asia/Riyadh", hour12: false });
  const [hStr, mStr] = saudiTimeStr.split(":");
  const nowMin = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

  let open = false;
  if (openMin < closeMin) {
    open = nowMin >= openMin && nowMin < closeMin;
  } else {
    open = nowMin >= openMin || nowMin < closeMin;
  }

  if (!open) {
    return {
      isOpen: false,
      reason: `Branch is closed. Operating hours are ${branch.openingTime} to ${branch.closingTime}.`
    };
  }

  return { isOpen: true };
};

const create = async (db, { userId, customerId, customerPhone, status, branchId, tableId, qrCashierId, type, items, notes, total, posUnit, source, staffId, staffName, selectedSlot, selectedSlotDate, customOrderTypeId }, tenantId) => {
  if (branchId) {
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (branch) {
      const openCheck = isBranchOpenNow(branch);
      if (!openCheck.isOpen) {
        throw new ApiError(400, openCheck.reason);
      }
    }
  }

  let finalCustomerId = customerId;
  if (customerPhone) {
    const cleanedPhone = customerPhone.trim();
    let appUser = await mainPrisma.appUser.findUnique({
      where: { phone: cleanedPhone }
    });
    if (!appUser) {
      appUser = await mainPrisma.appUser.create({
        data: {
          phone: cleanedPhone,
          name: "Guest Client"
        }
      });
    }
    finalCustomerId = appUser.id;
  }
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
    let pos = await db.posDevice.findUnique({ where: { deviceKey: posUnit } });
    if (!pos) {
      pos = await db.posDevice.findFirst({
        where: {
          name: posUnit,
          branchId: branchId
        }
      });
    }
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
      staffId: item.staffId || null,
      staffName: item.staffName || null,
      selectedSlot: item.selectedSlot || null,
      selectedSlotDate: item.selectedSlotDate || null,
    };
  });

  // Use the passed total if provided; otherwise fall back to subtotal
  const finalTotal = typeof total === "number" ? total : subtotal;

  const orderSource = source || (tableId ? "qr_table" : (qrCashierId ? "qr_cashier" : "pos"));

  // Look up fee percentage from main database
  let feeRate = 0.0;
  if (tenantId) {
    try {
      const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        feeRate = resolveTenantFeeRate(tenant, orderSource);
      }
    } catch (e) {
      console.error("Failed to query tenant fee settings:", e.message);
    }
  }

  const slotDetails = orderItems
    .filter(i => i.staffId && i.selectedSlot)
    .map(i => ({
      staffId: i.staffId,
      staffName: i.staffName,
      selectedSlot: i.selectedSlot,
      selectedSlotDate: i.selectedSlotDate,
      menuItemId: i.menuItemId,
      quantity: i.quantity,
    }));

  const order = await db.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      status: status || "PENDING",
      userId: userId || null,
      customerId: finalCustomerId || null,
      customerPhone: customerPhone || null,
      branchId,
      tableId: tableId || null,
      qrCashierId: qrCashierId || null,
      type: type || "DINE_IN",
      notes,
      total: finalTotal,
      feeRate,
      posUnit: posUnit || null,
      source: orderSource,
      staffId: staffId || null,
      staffName: staffName || null,
      selectedSlot: selectedSlot || null,
      selectedSlotDate: selectedSlotDate || null,
      slotDetails: slotDetails.length > 0 ? slotDetails : null,
      customOrderTypeId: customOrderTypeId || null,
      items: { create: orderItems },
    },
    include: { items: { include: { menuItem: true } }, branch: true, customOrderType: true },
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
        qrCashierId: order.qrCashierId,
        posUnit: order.posUnit,
        source: order.source,
        appUserId: order.customerId || null,
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        slotDetails: order.slotDetails || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      }
    });
  } catch (err) {
    console.error("[TENANT ORDER] Failed to create main database order:", err.message);
  }

  // Sync to super admin aggregated orders synchronously
  await syncToAggregatedOrder(db, tenantId, order).catch(console.error);

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
    include: { items: { include: { menuItem: true } }, table: true, customOrderType: true },
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
    include: { items: { include: { menuItem: true } }, branch: true, customOrderType: true },
    orderBy: { createdAt: "desc" },
  });

const getByCustomer = async (db, customerId) =>
  db.order.findMany({
    where: { customerId },
    include: { items: { include: { menuItem: true } }, branch: true, customOrderType: true },
    orderBy: { createdAt: "desc" },
  });

const updateOrder = async (db, id, { staffId, staffName, selectedSlot, selectedSlotDate, status, menuItemId }, tenantId) => {
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true }
  });
  if (!order) throw new ApiError(404, "Order not found");

  const updateData = {};
  if (status !== undefined) updateData.status = status;

  // Update specific slot inside slotDetails array if it exists
  let updatedSlotDetails = null;
  if (order.slotDetails && Array.isArray(order.slotDetails) && order.slotDetails.length > 0) {
    updatedSlotDetails = order.slotDetails.map(slot => {
      // If menuItemId matches, update that item's specialist and time allocation
      if (menuItemId && slot.menuItemId === menuItemId) {
        return {
          ...slot,
          staffId: staffId !== undefined ? staffId : slot.staffId,
          staffName: staffName !== undefined ? (staffName || null) : slot.staffName,
          selectedSlot: selectedSlot !== undefined ? selectedSlot : slot.selectedSlot,
          selectedSlotDate: selectedSlotDate !== undefined ? selectedSlotDate : slot.selectedSlotDate
        };
      }
      // If no menuItemId specified but there is only 1 slot item in slotDetails, update it
      if (!menuItemId && order.slotDetails.length === 1) {
        return {
          ...slot,
          staffId: staffId !== undefined ? staffId : slot.staffId,
          staffName: staffName !== undefined ? (staffName || null) : slot.staffName,
          selectedSlot: selectedSlot !== undefined ? selectedSlot : slot.selectedSlot,
          selectedSlotDate: selectedSlotDate !== undefined ? selectedSlotDate : slot.selectedSlotDate
        };
      }
      return slot;
    });

    updateData.slotDetails = updatedSlotDetails;

    // Update the matching OrderItem in the database
    if (menuItemId) {
      await db.orderItem.updateMany({
        where: { orderId: id, menuItemId },
        data: {
          staffId: staffId !== undefined ? (staffId || null) : undefined,
          staffName: staffName !== undefined ? (staffName || null) : undefined,
          selectedSlot: selectedSlot !== undefined ? (selectedSlot || null) : undefined,
          selectedSlotDate: selectedSlotDate !== undefined ? (selectedSlotDate || null) : undefined
        }
      });
    } else if (order.slotDetails.length === 1) {
      const singleItem = order.slotDetails[0];
      await db.orderItem.updateMany({
        where: { orderId: id, menuItemId: singleItem.menuItemId },
        data: {
          staffId: staffId !== undefined ? (staffId || null) : undefined,
          staffName: staffName !== undefined ? (staffName || null) : undefined,
          selectedSlot: selectedSlot !== undefined ? (selectedSlot || null) : undefined,
          selectedSlotDate: selectedSlotDate !== undefined ? (selectedSlotDate || null) : undefined
        }
      });
    }
  }

  // Update parent order level fields if single item slot or if no slotDetails exist
  const shouldUpdateParentFields = !order.slotDetails || !Array.isArray(order.slotDetails) || order.slotDetails.length <= 1 || (updatedSlotDetails && updatedSlotDetails.length === 1);
  if (shouldUpdateParentFields) {
    if (staffId !== undefined) updateData.staffId = staffId || null;
    if (staffName !== undefined) updateData.staffName = staffName || null;
    if (selectedSlot !== undefined) updateData.selectedSlot = selectedSlot || null;
    if (selectedSlotDate !== undefined) updateData.selectedSlotDate = selectedSlotDate || null;
  }

  const updated = await db.order.update({
    where: { id },
    data: updateData,
    include: { items: { include: { menuItem: true } }, table: true, branch: true, customOrderType: true }
  });

  // Sync to central main database Order registry
  try {
    const mainOrderExists = await mainPrisma.order.findUnique({ where: { id } });
    if (mainOrderExists) {
      await mainPrisma.order.update({
        where: { id },
        data: {
          status: updated.status,
          staffId: updated.staffId,
          staffName: updated.staffName,
          selectedSlot: updated.selectedSlot,
          selectedSlotDate: updated.selectedSlotDate,
          slotDetails: updated.slotDetails || undefined,
        }
      });
    }
  } catch (err) {
    console.error("[TENANT ORDER] Failed to sync order edit to main database:", err.message);
  }

  // Sync to aggregated order for Super Admin / POS view
  await syncToAggregatedOrder(db, tenantId, updated).catch(console.error);

  if (status !== undefined) {
    await handleOrderStatusLoyalty(db, updated, status, tenantId);
  }

  return updated;
};

const handleOrderStatusLoyalty = async (db, updated, status, tenantId) => {
  if (!updated || !updated.customerId) return;

  if (status === "COMPLETED") {
    if ((updated.paymentMethod || "").toLowerCase() === "points" || (updated.notes && (updated.notes.includes("Paid by Loyalty Points") || updated.notes.includes("Points Payment")))) {
      return;
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
            OR: [
              { orderNumber: updated.orderNumber },
              { orderId: updated.id },
              { description }
            ]
          }
        });

        if (!tx) {
          const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
          const earnRate = tenant ? tenant.loyaltyEarnRate : 1.0;
          const pointsToEarn = Math.floor(updated.total * earnRate);
          if (pointsToEarn > 0) {
            const loyaltyService = require("../loyalty/loyalty.service");
            await loyaltyService.earnPoints(db, updated.customerId, pointsToEarn, description, tenantId, {
              orderId: updated.id,
              orderNumber: updated.orderNumber
            });
          }
        }
      }
    } catch (err) {
      console.error("Failed to auto-award points on order completion:", err.message);
    }
  }

  if (status === "REFUNDED" || status === "CANCELLED") {
    try {
      const loyaltyService = require("../loyalty/loyalty.service");
      await loyaltyService.reverseOrderPoints(db, updated.customerId, updated.orderNumber, updated.pointsRedeemed, tenantId, updated.id);
    } catch (err) {
      console.error("Failed to reverse points on order cancel/refund:", err.message);
    }
  }
};

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
    include: { items: { include: { menuItem: true } }, table: true, branch: true, customOrderType: true }
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

  await handleOrderStatusLoyalty(db, updated, status, tenantId);

  // Sync to super admin aggregated orders synchronously
  await syncToAggregatedOrder(db, tenantId, updated).catch(console.error);

  return updated;
};

const getAll = async (db, { status, branchId, startDate, endDate } = {}) => {
  const where = {};
  if (status) where.status = status;
  if (branchId) {
    if (typeof branchId === "string" && branchId.includes(",")) {
      where.branchId = { in: branchId.split(",").map(b => b.trim()) };
    } else if (Array.isArray(branchId)) {
      where.branchId = { in: branchId };
    } else {
      where.branchId = branchId;
    }
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }
  const orders = await db.order.findMany({
    where,
    include: { items: { include: { menuItem: true } }, table: true, branch: true, customOrderType: true },
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

module.exports = { create, getByBranch, getByUser, getByCustomer, updateStatus, updateOrder, getAll };
