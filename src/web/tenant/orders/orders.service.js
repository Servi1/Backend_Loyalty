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
    const resolvedFeeRate = (order.feeRate !== undefined && order.feeRate !== null && !isNaN(Number(order.feeRate))) 
      ? Number(order.feeRate) 
      : resolveTenantFeeRate(tenant, order.source);

    let customerName = "Customer Walk-in";
    let customerPhone = order.customerPhone || null;

    if (order.notes) {
      const match = order.notes.match(/Customer:\s*([^|]+)/i);
      if (match && match[1].trim()) customerName = match[1].trim();
    }

    if (customerName === "Customer Walk-in" && order.customerId) {
      const customer = await mainPrisma.appUser.findUnique({ where: { id: order.customerId } });
      if (customer) {
        customerName = customer.name || customer.phone || "Customer Walk-in";
        if (!customerPhone) customerPhone = customer.phone || null;
      }
    }

    if (customerName === "Customer Walk-in" && order.customerPhone) {
      customerName = order.customerPhone;
    }

    let branch = order.branch;
    if (!branch && order.branchId) {
      branch = await db.branch.findUnique({ where: { id: order.branchId } });
    }

    let formattedItems = null;
    if (Array.isArray(order.items) && order.items.length > 0) {
      formattedItems = order.items.map((i) => ({
        id: i.id,
        quantity: i.quantity || 1,
        price: Number(i.price || 0),
        notes: i.notes || null,
        name: i.menuItem?.name || i.name || "Item",
      }));
    } else if (order.id) {
      const dbItems = await db.orderItem.findMany({
        where: { orderId: order.id },
        include: { menuItem: true }
      }).catch(() => []);
      if (dbItems.length > 0) {
        formattedItems = dbItems.map((i) => ({
          id: i.id,
          quantity: i.quantity || 1,
          price: Number(i.price || 0),
          notes: i.notes || null,
          name: i.menuItem?.name || i.name || "Item",
        }));
      }
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
        loyaltyEarnRate: order.loyaltyEarnRate ?? 0.0,
        source: order.source || "pos",
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        slotDetails: order.slotDetails || null,
        items: formattedItems || undefined,
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
        loyaltyEarnRate: order.loyaltyEarnRate ?? 0.0,
        source: order.source || "pos",
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        slotDetails: order.slotDetails || null,
        items: formattedItems || undefined,
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

const create = async (db, { userId, customerId, customerPhone, status, branchId, tableId, qrCashierId, type, items, notes, total, posUnit, source, staffId, staffName, selectedSlot, selectedSlotDate, customOrderTypeId, callerRole }, tenantId) => {
  const isStaff = Boolean(callerRole && ["ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"].includes(callerRole));
  if (!isStaff) {
    posUnit = null;
    if (source === "pos") {
      source = tableId ? "qr_table" : (qrCashierId ? "qr_cashier" : "mobile");
    }
  }
  if (branchId) {
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (branch) {
      const isScheduledOrManual = type === "SCHEDULED" || status === "HALTED" || source === "pos" || Boolean(selectedSlot);
      if (!isScheduledOrManual) {
        const openCheck = isBranchOpenNow(branch);
        if (!openCheck.isOpen) {
          throw new ApiError(400, openCheck.reason);
        }
      }
    }
  }

  // Validate if userId exists in tenantDb user table (since SuperAdmins or BrandAdmins from main DB might not be in tenantDb.user)
  let validUserId = null;
  if (userId) {
    const staffUser = await db.user.findUnique({ where: { id: userId } });
    if (staffUser) {
      validUserId = userId;
    }
  }

const normalizePhone = (rawPhone) => {
  if (!rawPhone) return "";
  let digits = rawPhone.toString().trim().replace(/[\s\-\(\)]/g, "");
  if (digits.startsWith("00966")) {
    digits = "+966" + digits.substring(5);
  }
  if (digits.startsWith("+966")) {
    let rest = digits.substring(4);
    if (rest.startsWith("0")) rest = rest.substring(1);
    return "+966" + rest;
  }
  if (digits.startsWith("966")) {
    let rest = digits.substring(3);
    if (rest.startsWith("0")) rest = rest.substring(1);
    return "+966" + rest;
  }
  if (digits.startsWith("0")) {
    digits = digits.substring(1);
  }
  if (/^5\d{8}$/.test(digits)) {
    return "+966" + digits;
  }
  if (!digits.startsWith("+") && digits.length >= 9) {
    return "+966" + digits;
  }
  return digits.startsWith("+") ? digits : `+${digits}`;
};

  let finalCustomerId = customerId;
  let normalizedCustomerPhone = customerPhone ? normalizePhone(customerPhone) : null;
  if (normalizedCustomerPhone) {
    let appUser = await mainPrisma.appUser.findUnique({
      where: { phone: normalizedCustomerPhone }
    });
    if (!appUser) {
      appUser = await mainPrisma.appUser.create({
        data: {
          phone: normalizedCustomerPhone,
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

    if (selectedSlot && selectedSlotDate) {
      const existingTableBooking = await db.order.findFirst({
        where: {
          branchId,
          tableId,
          selectedSlotDate,
          selectedSlot,
          status: { notIn: ["CANCELLED", "REFUNDED"] }
        }
      });
      if (existingTableBooking) {
        throw new ApiError(409, `This table is already booked for ${selectedSlotDate} at ${selectedSlot}. Please choose a different time slot.`);
      }
    }
  }

  if (staffId && selectedSlot && selectedSlotDate) {
    const existingStaffBooking = await db.order.findFirst({
      where: {
        branchId,
        staffId,
        selectedSlotDate,
        selectedSlot,
        status: { notIn: ["CANCELLED", "REFUNDED"] }
      }
    });
    if (existingStaffBooking) {
      throw new ApiError(409, `The selected specialist is already booked for ${selectedSlotDate} at ${selectedSlot}. Please choose a different time slot.`);
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
  const menuItemIds = items.map((i) => i.menuItemId || i.itemId || i.id).filter(Boolean);
  if (menuItemIds.length === 0) {
    throw new ApiError(400, "Order must contain valid menu items");
  }
  const menuItems = await db.menuItem.findMany({ where: { id: { in: menuItemIds }, isAvailable: true } });
  if (menuItems.length !== menuItemIds.length) {
    throw new ApiError(400, "One or more menu items are currently unavailable or not found");
  }

  let subtotal = 0;
  const orderItems = items.map((item) => {
    const targetId = item.menuItemId || item.itemId || item.id;
    const menuItem = menuItems.find((m) => m.id === targetId);
    if (!menuItem) throw new ApiError(400, `Menu item ${targetId} not found`);
    
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

  // Protect against price tampering: enforce server-calculated subtotal with +/- 0.05 rounding tolerance
  let finalTotal = subtotal;
  if (typeof total === "number" && !isNaN(total)) {
    if (isStaff && (posUnit || source === "pos")) {
      finalTotal = Math.max(0, total);
    } else if (Math.abs(total - subtotal) <= 0.05) {
      finalTotal = total;
    } else {
      console.warn(`[WEB ORDER] Client total (${total}) differs from calculated subtotal (${subtotal}). Enforcing verified subtotal.`);
      finalTotal = subtotal;
    }
  }

  const orderSource = source || (tableId ? "qr_table" : (qrCashierId ? "qr_cashier" : "pos"));

  // Look up fee percentage and loyalty earn rate from main database
  let feeRate = 0.0;
  let loyaltyEarnRate = 0.0;
  if (tenantId) {
    try {
      const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        if (paymentMethod === "points" || (notes && (notes.includes("Paid by Loyalty Points") || notes.includes("Points Payment")))) {
          if (!tenant.subLoyalty || !tenant.loyaltyEnabled || tenant.loyaltyRedeemPoints === false) {
            throw new ApiError(400, "Loyalty points program is currently disabled or not subscribed for this brand.");
          }
        }

        feeRate = resolveTenantFeeRate(tenant, orderSource);
        const isPointsActive = Boolean(tenant.subLoyalty && tenant.loyaltyEnabled && tenant.loyaltyAddPoints !== false);
        if (isPointsActive) {
          loyaltyEarnRate = Number(tenant.loyaltyEarnRate !== undefined && tenant.loyaltyEarnRate !== null ? tenant.loyaltyEarnRate : 1.0);
        } else {
          loyaltyEarnRate = 0.0;
        }

        const stampProg = Array.isArray(tenant.stampPrograms) ? tenant.stampPrograms[0] : null;
        const isStampsActive = Boolean(tenant.subStamps && stampProg && stampProg.enabled !== false);
        const stampsSnapshotTag = isStampsActive ? "[STAMPS_ELIGIBLE:true]" : "[STAMPS_ELIGIBLE:false]";
        const pointsSnapshotTag = isPointsActive ? "[POINTS_ELIGIBLE:true]" : "[POINTS_ELIGIBLE:false]";
        notes = [notes, stampsSnapshotTag, pointsSnapshotTag].filter(Boolean).join(" ");
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      console.error("Failed to query tenant fee and loyalty settings:", e.message);
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

  const order = await db.$transaction(async (tx) => {
    // Prevent double booking with transaction-level advisory locks
    if (tableId && selectedSlot && selectedSlotDate) {
      const tableLockKey = `slot_tbl_${branchId}_${tableId}_${selectedSlotDate}_${selectedSlot}`;
      try {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tableLockKey}))`;
      } catch (lockErr) {
        console.warn("[WEB ORDER LOCK] Advisory lock skipped/unsupported:", lockErr.message);
      }
      const existingTableBooking = await tx.order.findFirst({
        where: {
          branchId,
          tableId,
          selectedSlotDate,
          selectedSlot,
          status: { notIn: ["CANCELLED", "REFUNDED", "REJECTED"] }
        }
      });
      if (existingTableBooking) {
        throw new ApiError(409, `This table is already booked for ${selectedSlotDate} at ${selectedSlot}. Please choose a different time slot.`);
      }
    }

    if (staffId && selectedSlot && selectedSlotDate) {
      const staffLockKey = `slot_stf_${branchId}_${staffId}_${selectedSlotDate}_${selectedSlot}`;
      try {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${staffLockKey}))`;
      } catch (lockErr) {
        console.warn("[WEB ORDER LOCK] Advisory lock skipped/unsupported:", lockErr.message);
      }
      const existingStaffBooking = await tx.order.findFirst({
        where: {
          branchId,
          staffId,
          selectedSlotDate,
          selectedSlot,
          status: { notIn: ["CANCELLED", "REFUNDED", "REJECTED"] }
        }
      });
      if (existingStaffBooking) {
        throw new ApiError(409, `The selected specialist is already booked for ${selectedSlotDate} at ${selectedSlot}. Please choose a different time slot.`);
      }
    }

    const createdOrder = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        status: status || "PENDING",
        userId: validUserId || null,
        customerId: finalCustomerId || null,
        customerPhone: normalizedCustomerPhone || customerPhone || null,
        branchId,
        tableId: tableId || null,
        qrCashierId: qrCashierId || null,
        type: type || "DINE_IN",
        notes,
        total: finalTotal,
        feeRate,
        loyaltyEarnRate,
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

    if (createdOrder.tableId) {
      try {
        await tx.table.update({
          where: { id: createdOrder.tableId },
          data: { status: "busy" }
        });
      } catch (tblErr) {
        console.error("[WEB ORDER] Failed to update table status to busy:", tblErr.message);
      }
    }

    return createdOrder;
  });

  if (finalCustomerId) {
    const user = await mainPrisma.appUser.findUnique({ where: { id: finalCustomerId } });
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
        loyaltyEarnRate: order.loyaltyEarnRate,
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

  if ((order.status || "").toUpperCase() === "COMPLETED") {
    await handleOrderStatusLoyalty(db, order, order.status, tenantId).catch(console.error);
  }

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

  const currentStatus = (order.status || "").toUpperCase();
  const terminalStatuses = ["CANCELLED", "REJECTED", "REFUNDED"];
  if (terminalStatuses.includes(currentStatus)) {
    throw new ApiError(400, `Cannot modify order details. Order is already in terminal state '${currentStatus}'.`);
  }

  if (currentStatus === "COMPLETED") {
    if (status && status.toUpperCase() !== "REFUNDED") {
      throw new ApiError(400, "A completed order cannot be modified or reopened.");
    }
    if (staffId !== undefined || selectedSlot !== undefined || selectedSlotDate !== undefined) {
      throw new ApiError(400, "Cannot reschedule or reassign staff on a completed order.");
    }
  }

  if (status !== undefined) {
    const nextStatus = status.toUpperCase();
    if (nextStatus === "CANCELLED" || nextStatus === "REJECTED") {
      if (currentStatus !== "PENDING" && currentStatus !== "HALTED") {
        throw new ApiError(400, "Cannot cancel an order that has already been accepted or is in progress.");
      }
    }
  }

  // Prevent double booking when rescheduling
  const targetSlot = selectedSlot !== undefined ? selectedSlot : order.selectedSlot;
  const targetSlotDate = selectedSlotDate !== undefined ? selectedSlotDate : order.selectedSlotDate;
  const targetStaffId = staffId !== undefined ? staffId : order.staffId;
  const targetTableId = order.tableId;

  if (targetSlot && targetSlotDate) {
    const slotChanged = selectedSlot !== undefined || selectedSlotDate !== undefined || staffId !== undefined;
    if (slotChanged) {
      if (targetTableId) {
        const conflictTable = await db.order.findFirst({
          where: {
            id: { not: id },
            branchId: order.branchId,
            tableId: targetTableId,
            selectedSlotDate: targetSlotDate,
            selectedSlot: targetSlot,
            status: { notIn: ["CANCELLED", "REFUNDED", "REJECTED"] }
          }
        });
        if (conflictTable) {
          throw new ApiError(409, `This table is already booked for ${targetSlotDate} at ${targetSlot}. Please choose a different time slot.`);
        }
      }

      if (targetStaffId) {
        const conflictStaff = await db.order.findFirst({
          where: {
            id: { not: id },
            branchId: order.branchId,
            staffId: targetStaffId,
            selectedSlotDate: targetSlotDate,
            selectedSlot: targetSlot,
            status: { notIn: ["CANCELLED", "REFUNDED", "REJECTED"] }
          }
        });
        if (conflictStaff) {
          throw new ApiError(409, `The selected specialist is already booked for ${targetSlotDate} at ${targetSlot}. Please choose a different time slot.`);
        }
      }
    }
  }

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
    // Table status is adjusted manually only by branch manager or brand admin (auto-available logic removed)
  }

  return updated;
};

const handleOrderStatusLoyalty = async (db, updated, status, tenantId) => {
  if (!updated) return;

  let targetCustomerId = updated.customerId || updated.userId;
  if (!targetCustomerId && updated.customerPhone) {
    const cleanPhone = updated.customerPhone.trim().replace(/\s+/g, "");
    const withoutPlus = cleanPhone.replace(/^\+/, "");
    const withPlus = `+${withoutPlus}`;
    const userByPhone = await mainPrisma.appUser.findFirst({
      where: {
        OR: [
          { phone: cleanPhone },
          { phone: withoutPlus },
          { phone: withPlus }
        ]
      }
    });
    if (userByPhone) {
      targetCustomerId = userByPhone.id;
    }
  }

  if (!targetCustomerId) return;

  if (status === "COMPLETED") {
    const pMethod = (updated.paymentMethod || "").toLowerCase();
    if (pMethod === "points" || pMethod === "free_reward" || (updated.notes && (updated.notes.includes("Paid by Loyalty Points") || updated.notes.includes("Points Payment") || updated.notes.toLowerCase().includes("free reward")))) {
      return;
    }

    try {
      const customer = await mainPrisma.appUser.findUnique({
        where: { id: targetCustomerId },
        include: { wallets: true }
      });
      if (customer) {
        const loyaltyService = require("../loyalty/loyalty.service");
        const wallet = await loyaltyService.getWallet(db, targetCustomerId, tenantId);

        const description = `Earned on Order #${updated.orderNumber}`;
        const tx = await mainPrisma.walletTransaction.findFirst({
          where: {
            walletId: wallet.id,
            OR: [
              { orderNumber: updated.orderNumber },
              { orderId: updated.id },
              { description }
            ]
          }
        });

        if (!tx) {
          const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
          const { isOrderEligibleForLoyalty } = require("../../../shared/loyalty/loyaltyEligibility");

          // Real-time check if points/stamps was enabled when order was placed
          const pointsEligible = await isOrderEligibleForLoyalty(updated, tenantId, "POINTS", tenant);
          const stampsEligible = await isOrderEligibleForLoyalty(updated, tenantId, "STAMPS", tenant);

          if (!pointsEligible && !stampsEligible) {
            console.log(`[LOYALTY] Points/Stamps was NOT enabled at order creation time (${updated.createdAt}). Skipping award for order #${updated.orderNumber}`);
            return;
          }

          let earnRate = 0.0;
          if (pointsEligible) {
            if (updated.loyaltyEarnRate !== undefined && updated.loyaltyEarnRate !== null) {
              earnRate = Number(updated.loyaltyEarnRate);
            } else {
              earnRate = Number(tenant?.loyaltyEarnRate !== undefined && tenant?.loyaltyEarnRate !== null ? tenant.loyaltyEarnRate : 1.0);
            }
          }

          const pointsToEarn = earnRate > 0 ? Math.floor(updated.total * earnRate) : 0;
          await loyaltyService.earnPoints(db, targetCustomerId, pointsToEarn, description, tenantId, {
            orderId: updated.id,
            orderNumber: updated.orderNumber,
            orderCreatedAt: updated.createdAt,
            pointsEligible,
            stampsEligible,
            notes: updated.notes,
            items: updated.items
          });
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

  const currentStatus = (order.status || "").toUpperCase();
  const nextStatus = (status || "").toUpperCase();

  // If already at nextStatus and no notes change, return early (idempotent, avoid duplicate side-effects)
  if (currentStatus === nextStatus && notes === undefined) {
    return order;
  }

  // Terminal states cannot transition to any other status
  const terminalStatuses = ["CANCELLED", "REJECTED", "REFUNDED"];
  if (terminalStatuses.includes(currentStatus)) {
    throw new ApiError(400, `Cannot update order status. Order is already in terminal state '${currentStatus}'.`);
  }

  // Completed order can only transition to REFUNDED
  if (currentStatus === "COMPLETED") {
    if (nextStatus !== "REFUNDED") {
      throw new ApiError(400, "A completed order cannot be transitioned to any status other than REFUNDED.");
    }
  }

  // Disallow cancelling/rejecting an order that has already been accepted or is in progress
  if (nextStatus === "CANCELLED" || nextStatus === "REJECTED") {
    if (currentStatus !== "PENDING" && currentStatus !== "HALTED") {
      throw new ApiError(400, "Cannot cancel an order that has already been accepted or is in progress.");
    }
  }

  const updateData = { status };
  if (notes !== undefined) {
    const existingTags = (order.notes || "").match(/\[[A-Z0-9_]+:[^\]]+\]/g) || [];
    let mergedNotes = notes;
    for (const tag of existingTags) {
      if (!mergedNotes.includes(tag)) {
        mergedNotes = mergedNotes ? `${mergedNotes} ${tag}` : tag;
      }
    }
    updateData.notes = mergedNotes;
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
          ...(updateData.notes !== undefined && { notes: updateData.notes }),
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

const getAll = async (db, { status, branchId, startDate, endDate, page, limit } = {}) => {
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

  const queryOptions = {
    where,
    include: { items: { include: { menuItem: true } }, table: true, branch: true, customOrderType: true },
    orderBy: { createdAt: "desc" },
  };

  if (limit) {
    const take = Math.min(Math.max(1, Number(limit) || 25), 200);
    const skip = Math.max(0, ((Number(page) || 1) - 1) * take);
    queryOptions.take = take;
    queryOptions.skip = skip;
  }

  const orders = await db.order.findMany(queryOptions);

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
