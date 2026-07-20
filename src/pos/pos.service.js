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
  const orders = await db.order.findMany({
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

  // Enrich with customer user details from main database
  const customerIds = [...new Set(orders.map(o => o.customerId).filter(Boolean))];
  if (customerIds.length > 0) {
    try {
      const mainPrisma = require("../config/prisma");
      const appUsers = await mainPrisma.appUser.findMany({
        where: { id: { in: customerIds } }
      });
      orders.forEach(o => {
        o.customer = appUsers.find(u => u.id === o.customerId) || null;
      });
    } catch (err) {
      console.error("[POS SERVICE] Failed to enrich orders with customer profiles:", err.message);
    }
  }

  return orders;
};

/**
 * Create a new order with multiple items.
 */
const createOrder = async (db, branchId, userId, orderData, tenantId) => {
  const { type, total, items, tableId, notes, paymentMethod } = orderData;
  
  if (!items || items.length === 0) {
    throw new ApiError(400, "Order must contain at least one item.");
  }

  // Generate unique order number
  let orderNumber = "";
  let isUnique = false;
  let attempts = 0;
  const isOffline = !!orderData.isOffline;
  while (!isUnique && attempts < 10) {
    const suffix = Math.floor(100000 + Math.random() * 900000);
    orderNumber = `ORD-${suffix}${isOffline ? '-OFF' : ''}`;
    const existing = await db.order.findUnique({ where: { orderNumber } });
    if (!existing) isUnique = true;
    attempts++;
  }

  const order = await db.order.create({
    data: {
      orderNumber,
      status: orderData.status || "ACCEPTED",
      type: type || "DINE_IN",
      total: Number(total) || 0,
      notes,
      branchId,
      userId,
      tableId,
      customOrderTypeId: orderData.customOrderTypeId || undefined,
      customerId: orderData.customerId || undefined,
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

  if (tenantId) {
    syncToAggregatedOrder(db, tenantId, order).catch(console.error);
  }

  // Award loyalty points immediately at order creation if customer is present and not halted
  if (order.customerId && order.status !== "HALTED" && orderData.paymentMethod !== "points") {
    try {
      const mainPrisma = require("../config/prisma");
      const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
      const earnRate = tenant ? tenant.loyaltyEarnRate : 1.0;
      const pointsToEarn = Math.floor(order.total * earnRate);
      
      if (pointsToEarn > 0) {
        const loyaltyService = require("../web/tenant/loyalty/loyalty.service");
        await loyaltyService.earnPoints(
          db,
          order.customerId,
          pointsToEarn,
          `Earned on Order #${order.orderNumber}`,
          tenantId
        );
      }
    } catch (err) {
      console.error("[POS ORDER] Failed to award points on order creation:", err.message);
    }
  }

  return order;
};

/**
 * Update the status of an existing order.
 */
// Local helper to sync orders to super admin database (aggregated orders)
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
        updatedAt: order.updatedAt,
      }
    });
  } catch (err) {
    console.error("Failed to sync order to super admin database:", err.message);
  }
};

const updateOrderStatus = async (db, orderId, status, tenantId, paymentMethod) => {
  const validStatuses = ["HALTED", "PENDING", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
  const upperStatus = status.toUpperCase();
  if (!validStatuses.includes(upperStatus)) {
    throw new ApiError(400, `Invalid status value: ${status}`);
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  // Enforce transition rules
  if (upperStatus === "ACCEPTED") {
    if (order.status !== "PENDING" && order.status !== "HALTED") {
      throw new ApiError(400, "Only PENDING or HALTED orders can be updated to ACCEPTED");
    }
  }

  const updateData = { status: upperStatus };
  if (paymentMethod) {
    updateData.paymentMethod = paymentMethod;
  }

  const updated = await db.order.update({
    where: { id: orderId },
    data: updateData,
    include: {
      items: {
        include: { menuItem: true }
      },
      table: true,
      branch: true
    }
  });

  // Sync status update to main database
  try {
    const mainPrisma = require("../config/prisma");
    const mainOrderExists = await mainPrisma.order.findUnique({ where: { id: orderId } });
    if (mainOrderExists) {
      const mainUpdate = {
        status: upperStatus,
        updatedAt: updated.updatedAt,
      };
      if (paymentMethod) {
        mainUpdate.paymentMethod = paymentMethod;
      }
      await mainPrisma.order.update({
        where: { id: orderId },
        data: mainUpdate
      });
    }
  } catch (err) {
    console.error("[POS ORDER] Failed to update main database order status:", err.message);
  }

  // If moving from HALTED to ACCEPTED, handle loyalty points award immediately (as it was skipped during createOrder)
  if (upperStatus === "ACCEPTED" && order.status === "HALTED" && updated.customerId && paymentMethod !== "points" && updated.paymentMethod !== "points") {
    try {
      const mainPrisma = require("../config/prisma");
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
            const loyaltyService = require("../web/tenant/loyalty/loyalty.service");
            await loyaltyService.earnPoints(
              db,
              updated.customerId,
              pointsToEarn,
              description,
              tenantId
            );
          }
        }
      }
    } catch (err) {
      console.error("[POS ORDER] Failed to award points on halted order accept:", err.message);
    }
  }

  // If completed and customer exists, handle loyalty points auto-award
  if (upperStatus === "COMPLETED" && updated.customerId) {
    if (!(updated.notes && updated.notes.includes("Points Payment") || updated.paymentMethod === "points")) {
      try {
        const mainPrisma = require("../config/prisma");
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
              const loyaltyService = require("../web/tenant/loyalty/loyalty.service");
              await loyaltyService.earnPoints(db, updated.customerId, pointsToEarn, description, tenantId);
            }
          }
        }
      } catch (err) {
        console.error("Failed to auto-award points on order completion:", err.message);
      }
    }
  }

  // Sync to super admin aggregated orders asynchronously
  syncToAggregatedOrder(db, tenantId, updated).catch(console.error);

  return updated;
};

const getEODReport = async (db, branchId, dateStr) => {
  if (!dateStr) {
    throw new ApiError(400, "Date parameter is required.");
  }
  // Setup date range (Local server time)
  const startOfDay = new Date(`${dateStr}T00:00:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999`);

  // Setup previous day date range (Local server time)
  const prevDateObj = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
  const prevYear = prevDateObj.getFullYear();
  const prevMonth = String(prevDateObj.getMonth() + 1).padStart(2, '0');
  const prevDay = String(prevDateObj.getDate()).padStart(2, '0');
  const prevDateStr = `${prevYear}-${prevMonth}-${prevDay}`;
  const startOfPrevDay = new Date(`${prevDateStr}T00:00:00`);
  const endOfPrevDay = new Date(`${prevDateStr}T23:59:59.999`);

  // Fetch branch details
  const branch = await db.branch.findUnique({
    where: { id: branchId }
  });

  // Fetch active/completed orders for this branch and date range
  const orders = await db.order.findMany({
    where: {
      branchId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay
      },
      status: {
        in: ["ACCEPTED", "PREPARING", "READY", "COMPLETED"]
      }
    },
    include: {
      items: {
        include: { menuItem: true }
      }
    }
  });

  // Fetch orders for previous day to calculate growth
  const prevOrders = await db.order.findMany({
    where: {
      branchId,
      createdAt: {
        gte: startOfPrevDay,
        lte: endOfPrevDay
      },
      status: {
        in: ["ACCEPTED", "PREPARING", "READY", "COMPLETED"]
      }
    }
  });

  const prevSales = prevOrders.reduce((sum, o) => sum + o.total, 0);

  // Calculate stats
  let totalSales = 0;
  let totalOrders = orders.length;
  let paymentsMap = {
    cash: 0,
    card: 0,
    mobile: 0
  };
  let itemsMap = {};

  orders.forEach(order => {
    totalSales += order.total;

    // Group payment methods
    const method = (order.paymentMethod || "cash").toLowerCase();
    if (method === "cash") {
      paymentsMap.cash += order.total;
    } else if (method === "card") {
      paymentsMap.card += order.total;
    } else {
      paymentsMap.mobile += order.total; // apple_pay, google_pay, points, split etc.
    }

    // Group items
    order.items.forEach(item => {
      const mItem = item.menuItem;
      if (mItem) {
        if (!itemsMap[mItem.id]) {
          itemsMap[mItem.id] = {
            itemKey: mItem.id,
            name: mItem.name,
            quantity: 0,
            revenue: 0
          };
        }
        itemsMap[mItem.id].quantity += item.quantity;
        itemsMap[mItem.id].revenue += item.price * item.quantity;
      }
    });
  });

  const avgOrder = totalOrders > 0 ? Number((totalSales / totalOrders).toFixed(2)) : 0;
  
  // Calculate sales growth vs yesterday
  let salesGrowth = 0;
  if (prevSales === 0) {
    salesGrowth = totalSales > 0 ? 100.0 : 0.0;
  } else {
    salesGrowth = Number((((totalSales - prevSales) / prevSales) * 100).toFixed(1));
  }

  // Format payments array
  const payments = [
    { methodKey: "cash", amount: Number(paymentsMap.cash.toFixed(2)) },
    { methodKey: "card", amount: Number(paymentsMap.card.toFixed(2)) },
    { methodKey: "mobile", amount: Number(paymentsMap.mobile.toFixed(2)) }
  ];

  // Format top items array (sorted by quantity desc)
  const topItems = Object.values(itemsMap)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5)
    .map(item => ({
      itemKey: item.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
      name: item.name,
      quantity: item.quantity,
      revenue: Number(item.revenue.toFixed(2))
    }));

  return {
    branchName: branch?.name || "Unknown Branch",
    date: dateStr,
    totalSales: Number(totalSales.toFixed(2)),
    totalOrders,
    avgOrder,
    payments,
    topItems,
    salesGrowth
  };
};

const generateEODReportPDF = async (report, user, stream) => {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 50 });

  // Pipe the document to the stream (response)
  doc.pipe(stream);

  // Colors Palette
  const primaryColor = "#4f46e5"; // Indigo
  const tealColor = "#0f766e";    // Teal
  const darkColor = "#0f172a";    // Dark slate
  const grayMuted = "#475569";    // Muted slate
  const borderLight = "#e2e8f0";  // Light border
  const bgLight = "#f8fafc";      // Slate 50
  
  // Header Banner
  doc.rect(50, 45, 512, 65).fill(primaryColor);
  
  // Title & Header details in White
  doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold").text("END OF DAY SALES REPORT", 65, 58);
  doc.fontSize(9).font("Helvetica").fillColor("#c7d2fe").text(`Branch: ${report.branchName}  |  Date: ${report.date}  |  Currency: USD`, 65, 82);

  // Divider spacing
  doc.y = 135;

  // Summary Metrics Section (Grid Layout)
  const startY = doc.y;
  const cardWidth = 158;
  const cardHeight = 75;

  // Card 1: Revenue
  doc.roundedRect(50, startY, cardWidth, cardHeight, 8).fill(bgLight).strokeColor(borderLight).lineWidth(1).stroke();
  doc.fillColor(grayMuted).fontSize(8).font("Helvetica").text("TOTAL SALES", 65, startY + 12);
  doc.fillColor(tealColor).fontSize(16).font("Helvetica-Bold").text(`$${report.totalSales.toFixed(2)}`, 65, startY + 26);
  
  // Growth pill
  const growthVal = report.salesGrowth || 0;
  const isPositive = growthVal >= 0;
  const pillColor = isPositive ? "#dcfce7" : "#fee2e2";
  const pillTextColor = isPositive ? "#15803d" : "#b91c1c";
  const growthSign = isPositive ? "+" : "";

  doc.roundedRect(65, startY + 48, 55, 15, 4).fill(pillColor);
  doc.fillColor(pillTextColor).fontSize(7.5).font("Helvetica-Bold").text(`${growthSign}${growthVal.toFixed(1)}%`, 72, startY + 52);

  // Card 2: Transactions
  doc.roundedRect(227, startY, cardWidth, cardHeight, 8).fill(bgLight).strokeColor(borderLight).lineWidth(1).stroke();
  doc.fillColor(grayMuted).fontSize(8).font("Helvetica").text("TOTAL TRANSACTIONS", 242, startY + 12);
  doc.fillColor(darkColor).fontSize(16).font("Helvetica-Bold").text(`${report.totalOrders}`, 242, startY + 26);
  doc.fillColor(grayMuted).fontSize(8).font("Helvetica").text("Orders Placed", 242, startY + 50);

  // Card 3: Avg Transaction
  doc.roundedRect(404, startY, cardWidth, cardHeight, 8).fill(bgLight).strokeColor(borderLight).lineWidth(1).stroke();
  doc.fillColor(grayMuted).fontSize(8).font("Helvetica").text("AVERAGE TRANSACTION", 419, startY + 12);
  doc.fillColor(darkColor).fontSize(16).font("Helvetica-Bold").text(`$${report.avgOrder.toFixed(2)}`, 419, startY + 26);
  doc.fillColor(grayMuted).fontSize(8).font("Helvetica").text("Per Ticket Value", 419, startY + 50);

  doc.y = startY + 95;

  // Payments Breakdown Section (Styled Rows)
  doc.fillColor(darkColor).fontSize(12).font("Helvetica-Bold").text("Payment Breakdown", 50, doc.y);
  doc.moveDown(0.6);

  const availablePayments = (report.payments || []).filter(p => p.amount > 0);

  if (availablePayments.length === 0) {
    doc.fillColor(grayMuted).fontSize(9).font("Helvetica-Oblique").text("No payments processed on this day.");
    doc.moveDown(1.5);
  } else {
    availablePayments.forEach(payment => {
      const percentage = report.totalSales > 0 ? ((payment.amount / report.totalSales) * 100).toFixed(1) : "0.0";
      const y = doc.y;

      // Draw light card row background
      doc.roundedRect(50, y, 512, 28, 4).fill(bgLight).strokeColor(borderLight).lineWidth(0.5).stroke();
      
      // Print values on top of the card
      doc.fillColor(darkColor).fontSize(9.5).font("Helvetica-Bold").text(payment.methodKey.toUpperCase(), 65, y + 9);
      doc.fillColor(grayMuted).font("Helvetica").text(`$${payment.amount.toFixed(2)}`, 200, y + 9);
      doc.fillColor(primaryColor).font("Helvetica-Bold").text(`${percentage}% of sales`, 390, y + 9, { align: "right", width: 160 });

      doc.y = y + 34; // spacing below row
    });
    doc.moveDown(0.8);
  }

  // Top Selling Items Section (Table format)
  doc.fillColor(darkColor).fontSize(12).font("Helvetica-Bold").text("Top Selling Products", 50, doc.y);
  doc.moveDown(0.6);

  if (!report.topItems || report.topItems.length === 0) {
    doc.fillColor(grayMuted).fontSize(9).font("Helvetica-Oblique").text("No menu items sold on this day.");
  } else {
    const tableTop = doc.y;
    
    // Header background
    doc.rect(50, tableTop, 512, 20).fill("#f1f5f9");
    
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor(grayMuted);
    doc.text("Product Name", 65, tableTop + 6);
    doc.text("Qty Sold", 320, tableTop + 6, { width: 80, align: "right" });
    doc.text("Revenue", 445, tableTop + 6, { width: 100, align: "right" });

    doc.y = tableTop + 20;

    report.topItems.forEach((item, index) => {
      const currentY = doc.y;
      
      // Zebra striping
      if (index % 2 === 1) {
        doc.rect(50, currentY, 512, 22).fill("#f8fafc");
      }
      
      doc.fontSize(9).font("Helvetica").fillColor(darkColor);
      doc.text(item.name, 65, currentY + 6);
      doc.text(`${item.quantity} pcs`, 320, currentY + 6, { width: 80, align: "right" });
      doc.text(`$${item.revenue.toFixed(2)}`, 445, currentY + 6, { width: 100, align: "right" });
      
      // Bottom divider border
      doc.strokeColor(borderLight).lineWidth(0.5).moveTo(50, currentY + 22).lineTo(562, currentY + 22).stroke();
      doc.y = currentY + 22;
    });
  }

  // Footer Section
  doc.y = Math.max(doc.y + 40, 680);
  doc.strokeColor(borderLight).lineWidth(1).moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.6);
  doc.fontSize(8).fillColor(grayMuted).text(`Printed by Cashier: ${user.name || user.phone}  |  Generated at: ${new Date().toLocaleString()}`, { align: "center" });

  // Finalize document
  doc.end();
};

const getCurrentCashDrawerSession = async (db, branchId) => {
  const session = await db.cashDrawerSession.findFirst({
    where: {
      branchId,
      status: "OPEN",
    },
    include: {
      openedBy: true,
      closedBy: true,
    }
  });

  if (session) {
    // Fetch live cash orders processed during this shift
    const cashOrders = await db.order.findMany({
      where: {
        branchId,
        createdAt: {
          gte: session.openedAt
        },
        paymentMethod: "cash",
        status: { in: ["ACCEPTED", "PREPARING", "READY", "COMPLETED"] }
      },
      orderBy: { createdAt: "desc" }
    });

    const expectedSales = cashOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const expectedEndingBalance = Number(session.openingBalance) + expectedSales;

    const transactions = cashOrders.map(o => ({
      id: o.id,
      type: "in",
      description: `#${o.orderNumber}`,
      amount: Number(o.total || 0),
      time: new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }));

    return {
      ...session,
      expectedSales,
      expectedEndingBalance,
      transactions
    };
  }

  return null;
};

const openCashDrawerSession = async (db, branchId, userId, openingBalance) => {
  const active = await db.cashDrawerSession.findFirst({
    where: { branchId, status: "OPEN" }
  });
  if (active) {
    throw new ApiError(400, "A cash drawer session is already open for this branch.");
  }

  return await db.cashDrawerSession.create({
    data: {
      branchId,
      openedById: userId,
      openingBalance: Number(openingBalance) || 0,
      status: "OPEN"
    }
  });
};

const closeCashDrawerSession = async (db, sessionId, userId, actualEndingBalance, cashCounts) => {
  const session = await db.cashDrawerSession.findUnique({
    where: { id: sessionId }
  });
  if (!session) {
    throw new ApiError(404, "Cash drawer session not found.");
  }
  if (session.status === "CLOSED") {
    throw new ApiError(400, "This cash drawer session is already closed.");
  }

  // Find all cash orders processed during this shift
  const cashOrders = await db.order.findMany({
    where: {
      branchId: session.branchId,
      createdAt: {
        gte: session.openedAt
      },
      paymentMethod: "cash",
      status: { in: ["ACCEPTED", "PREPARING", "READY", "COMPLETED"] }
    },
    orderBy: { createdAt: "desc" }
  });

  const expectedSales = cashOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const expectedEnding = Number(session.openingBalance) + expectedSales;
  const actualEnding = Number(actualEndingBalance) || 0;
  const discrepancy = actualEnding - expectedEnding;

  // Compile transaction logs
  const transactions = cashOrders.map(o => ({
    id: o.id,
    type: "in",
    description: `#${o.orderNumber}`,
    amount: Number(o.total || 0),
    time: new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }));

  return await db.cashDrawerSession.update({
    where: { id: sessionId },
    data: {
      closedById: userId,
      closedAt: new Date(),
      actualEndingBalance: actualEnding,
      expectedEndingBalance: expectedEnding,
      expectedSales: expectedSales,
      discrepancy: discrepancy,
      status: "CLOSED",
      cashCounts: cashCounts || {},
      transactions: transactions
    }
  });
};

const getCashDrawerSessions = async (db, branchId) => {
  return await db.cashDrawerSession.findMany({
    where: { branchId },
    orderBy: { createdAt: "desc" },
    include: {
      openedBy: true,
      closedBy: true
    }
  });
};

module.exports = {
  getCatalog,
  getTables,
  getOrders,
  createOrder,
  updateOrderStatus,
  getEODReport,
  generateEODReportPDF,
  getCurrentCashDrawerSession,
  openCashDrawerSession,
  closeCashDrawerSession,
  getCashDrawerSessions
};
