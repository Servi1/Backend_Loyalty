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
        customerPhone: order.customerPhone || null,
        branchName: branch?.name || "Unknown",
        feeRate: order.feeRate || 0.0,
        source: order.source || "app",
        paymentMethod: order.paymentMethod || "cash",
        pointsRedeemed: order.pointsRedeemed || null,
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
        customerPhone: order.customerPhone || null,
        feeRate: order.feeRate || 0.0,
        source: order.source || "app",
        paymentMethod: order.paymentMethod || "cash",
        pointsRedeemed: order.pointsRedeemed || null,
        staffId: order.staffId || null,
        staffName: order.staffName || null,
        selectedSlot: order.selectedSlot || null,
        selectedSlotDate: order.selectedSlotDate || null,
        slotDetails: order.slotDetails || null,
        updatedAt: order.updatedAt,
      },
    });
  } catch (err) {
    console.error("[APP] Failed to sync order to super admin DB:", err.message);
  }
};

// ─── placeOrder ───────────────────────────────────────────────────────────────

const placeOrder = async (db, userId, body, tenantId, tenant) => {
  const { branchId, tableId, qrCashierId, cashierId, type = "DINE_IN", customOrderTypeId, items, notes, total, paymentMethod, source, staffId, earnRate, selectedSlot, selectedSlotDate, customerName, customerPhone } = body;

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
      staffId: item.staffId || null,
      staffName: item.staffName || null,
      selectedSlot: item.selectedSlot || null,
      selectedSlotDate: item.selectedSlotDate || null,
    };
  });

  if (typeof total === "number" && Math.abs(total - subtotal) > 0.01) {
    console.warn(
      `[APP ORDER] Client total mismatch: client=${total}, server=${subtotal}. Using server total.`
    );
  }

  const orderNumber = generateOrderNumber();
  let finalNotes = notes || "";
  if (customerName) {
    finalNotes = finalNotes ? `Customer: ${customerName} | ${finalNotes}` : `Customer: ${customerName}`;
  }
  let pointsRedeemed = null;

  // Lookup or create customer account by phone number in central AppUser table
  let finalCustomerId = userId || null;
  if (customerPhone) {
    const cleanedPhone = customerPhone.trim();
    try {
      let appUser = await mainPrisma.appUser.findUnique({
        where: { phone: cleanedPhone }
      });
      if (!appUser) {
        appUser = await mainPrisma.appUser.create({
          data: {
            phone: cleanedPhone,
            name: customerName ? customerName.trim() : "Guest Customer"
          }
        });
      } else if (customerName && (!appUser.name || appUser.name === "Guest Customer")) {
        await mainPrisma.appUser.update({
          where: { id: appUser.id },
          data: { name: customerName.trim() }
        });
      }
      finalCustomerId = appUser.id;
    } catch (err) {
      console.error("[PUBLIC ORDER] Failed to lookup/create appUser by phone:", err.message);
    }
  }

  if (paymentMethod === "points") {
    const redeemRate = Number(tenant?.loyaltyRedeemRate || 100.0);
    const pointsCost = Math.round(subtotal * redeemRate);
    const wallet = await loyaltyService.getWallet(db, finalCustomerId || userId);
    if (!wallet || wallet.points < pointsCost) {
      throw new ApiError(400, "Insufficient points to complete this order");
    }
    pointsRedeemed = pointsCost;
    // Redeem points — link transaction to this order so the wallet history shows the order number
    await loyaltyService.redeemPoints(
      db,
      finalCustomerId || userId,
      pointsCost,
      `Redeemed ${pointsCost} pts for order ${orderNumber}`,
      tenantId,
      { orderId: null, orderNumber } // orderId filled after order creation below
    );
    finalNotes = finalNotes ? `${finalNotes} | Points Payment` : "Points Payment";
  }

  let orderStaffId = null;
  let staffName = null;
  if (staffId) {
    const staffExists = await db.user.findUnique({ where: { id: staffId } });
    if (staffExists) {
      orderStaffId = staffId;
      staffName = staffExists.name;
      finalNotes = finalNotes ? `${finalNotes} | Assigned: ${staffExists.name}` : `Assigned: ${staffExists.name}`;
    } else {
      const mockNames = {
        chefAhmed: "Chef Ahmed",
        chefSarah: "Chef Sarah",
        chefJohn: "Chef John"
      };
      const mockName = mockNames[staffId] || staffId;
      staffName = mockName;
      finalNotes = finalNotes ? `${finalNotes} | Assigned: ${mockName}` : `Assigned: ${mockName}`;
    }
  }

  const finalQrCashierId = qrCashierId || cashierId || null;
  const orderSource = source || (tableId ? "qr_table" : (finalQrCashierId ? "qr_cashier" : "app"));

  // Look up fee percentage from main database using order channel source
  let feeRate = 0.0;
  if (tenantId) {
    try {
      const tenantObj = tenant || (await mainPrisma.tenant.findUnique({ where: { id: tenantId } }));
      if (tenantObj) {
        feeRate = resolveTenantFeeRate(tenantObj, orderSource);
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
      orderNumber,
      customerId: finalCustomerId,
      customerPhone: customerPhone || null,
      branchId,
      tableId: tableId || null,
      qrCashierId: finalQrCashierId,
      userId: orderStaffId,
      staffId: staffId || null,
      staffName: staffName || null,
      selectedSlot: selectedSlot || null,
      selectedSlotDate: selectedSlotDate || null,
      slotDetails: slotDetails.length > 0 ? slotDetails : null,
      type,
      notes: finalNotes || null,
      total: subtotal,
      feeRate,
      source: orderSource,
      paymentMethod: paymentMethod || "cash",
      pointsRedeemed: pointsRedeemed,
      customOrderTypeId: customOrderTypeId || null,
      items: { create: orderItems },
    },
    include: {
      items: { include: { menuItem: true } },
      branch: true,
      table: true,
    },
  });

  // Award points based on earnRate parameter (except if paid by points)
  if (userId && earnRate && paymentMethod !== "points") {
    const rate = parseFloat(earnRate);
    if (rate > 0) {
      const pointsEarned = Math.round(subtotal * rate);
      if (pointsEarned > 0) {
        try {
          await loyaltyService.earnPoints(
            db,
            userId,
            pointsEarned,
            `Points earned for Order #${orderNumber}`,
            tenantId
          );
        } catch (err) {
          console.error("[APP ORDER] Failed to award loyalty points:", err.message);
        }
      }
    }
  }

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
        qrCashierId: order.qrCashierId,
        source: order.source,
        appUserId: userId,
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
    console.error("[APP ORDER] Failed to create order in main database:", err.message);
  }

  // Fire-and-forget — non-blocking side effects
  syncToAggregatedOrder(db, tenantId, order).catch(console.error);

  return order;
};

// ─── getMyOrders ──────────────────────────────────────────────────────────────

const getMyOrders = async (db, userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;

  if (db) {
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
  }

  // Global query across all tenants
  const total = await mainPrisma.order.count({ where: { appUserId: userId } });
  const mainOrders = await mainPrisma.order.findMany({
    where: { appUserId: userId },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const { getTenantClient } = require("../../config/tenantManager");
  const enrichedOrders = [];

  for (const mainOrder of mainOrders) {
    try {
      const tenant = await mainPrisma.tenant.findUnique({ where: { id: mainOrder.tenantId } });
      if (tenant) {
        const tenantDb = getTenantClient(tenant.dbUrl);
        const detailedOrder = await tenantDb.order.findUnique({
          where: { id: mainOrder.id },
          include: {
            items: { include: { menuItem: { select: { name: true, price: true } } } },
            branch: { select: { id: true, name: true, address: true } },
          },
        });
        if (detailedOrder) {
          enrichedOrders.push(detailedOrder);
          continue;
        }
      }
    } catch (err) {
      console.error(`Failed to enrich order ${mainOrder.id} for user ${userId}:`, err.message);
    }

    // Fallback if tenant DB lookup fails
    enrichedOrders.push({
      ...mainOrder,
      items: [],
      branch: { id: mainOrder.branchId, name: "Unknown Branch", address: null }
    });
  }

  return {
    orders: enrichedOrders,
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
  if (db) {
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
  }

  const mainOrder = await mainPrisma.order.findFirst({
    where: { id: orderId, appUserId: userId }
  });
  if (!mainOrder) throw new ApiError(404, "Order not found");

  const tenant = await mainPrisma.tenant.findUnique({ where: { id: mainOrder.tenantId } });
  if (!tenant) throw new ApiError(404, "Brand not found");

  const { getTenantClient } = require("../../config/tenantManager");
  const tenantDb = getTenantClient(tenant.dbUrl);
  const detailedOrder = await tenantDb.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { menuItem: true } },
      branch: true,
      table: true,
    },
  });

  if (!detailedOrder) throw new ApiError(404, "Order not found in tenant database");
  return detailedOrder;
};

const payHaltedOrder = async (orderId, userId) => {
  // 1. Find the order in main database to verify ownership & fetch tenantId
  const mainOrder = await mainPrisma.order.findFirst({
    where: { id: orderId, appUserId: userId },
  });
  if (!mainOrder) throw new ApiError(404, "Order not found");

  // 2. Resolve tenant
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: mainOrder.tenantId } });
  if (!tenant) throw new ApiError(404, "Brand not found");

  // 3. Resolve tenant DB client
  const { getTenantClient } = require("../../config/tenantManager");
  const tenantDb = getTenantClient(tenant.dbUrl);

  // 4. Update status in main registry
  await mainPrisma.order.update({
    where: { id: orderId },
    data: { status: "PENDING" },
  });

  // 5. Update status in tenant DB
  const updatedTenantOrder = await tenantDb.order.update({
    where: { id: orderId },
    data: { status: "PENDING" },
    include: {
      items: { include: { menuItem: true } },
      branch: true,
      table: true,
    },
  });

  // 6. Sync to aggregated order for Super Admin / POS view
  await syncToAggregatedOrder(tenantDb, mainOrder.tenantId, updatedTenantOrder);

  return updatedTenantOrder;
};

module.exports = { placeOrder, getMyOrders, getOrder, payHaltedOrder };
