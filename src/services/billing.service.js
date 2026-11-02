const mainPrisma = require("../config/prisma");
const paymentService = require("./payment.service");

// Helper to determine last calendar day of a given month
function getLastDayOfMonth(year, month) {
  // month is 0-indexed: 0 = Jan, 11 = Dec
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Generate 1st of the Month Recurring Subscriptions Invoice for all active tenants
 */
async function generateMonthlyRecurringInvoices(targetDate = new Date()) {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth(); // 0-indexed
  const monthNumStr = String(month + 1).padStart(2, "0");
  const monthName = targetDate.toLocaleDateString("en-US", { month: "long" });

  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const lastDay = getLastDayOfMonth(year, month);
  const monthEnd = new Date(year, month, lastDay, 23, 59, 59, 999);

  const tenants = await mainPrisma.tenant.findMany({
    where: { isActive: true },
    include: { slotAddons: true }
  });

  const generatedInvoices = [];

  for (const tenant of tenants) {
    const invoiceId = `INV-${tenant.slug.toUpperCase()}-${year}${monthNumStr}-SUB`;

    // 1. Idempotency check: Do not re-generate if already exists
    const existing = await mainPrisma.tenantInvoice.findUnique({
      where: { id: invoiceId }
    });

    if (existing) {
      continue;
    }

    // 2. Build global services & slots breakdown
    const serviceConfigs = [
      { flag: "subAppServi", priceKey: "priceAppServi", label: "App Servi License", typeKey: "app_servi", isSlot: false, defaultPrice: 29.0 },
      { flag: "subAppBrand", priceKey: "priceAppBrand", label: "App Brand License", typeKey: "app_brand", isSlot: false, defaultPrice: 99.0 },
      { flag: "subPos", qtyKey: "posQuantity", priceKey: "pricePos", label: "POS Terminal", typeKey: "pos", isSlot: true, defaultPrice: 49.0 },
      { flag: "subQrTable", qtyKey: "qrTableQuantity", priceKey: "priceQrTable", label: "QR Table Dining", typeKey: "qr_table", isSlot: true, defaultPrice: 19.0 },
      { flag: "subQrCashier", qtyKey: "qrCashierQuantity", priceKey: "priceQrCashier", label: "QR Cashier Counter", typeKey: "qr_cashier", isSlot: true, defaultPrice: 9.0 },
      { flag: "subKds", qtyKey: "kdsQuantity", priceKey: "priceKds", label: "KDS Kitchen Screen", typeKey: "kds", isSlot: true, defaultPrice: 19.0 },
      { flag: "subCds", qtyKey: "cdsQuantity", priceKey: "priceCds", label: "CDS Customer Display", typeKey: "cds", isSlot: true, defaultPrice: 9.0 },
      { flag: "subBranch", qtyKey: "branchLimit", priceKey: "priceBranch", label: "Branch Location", typeKey: "branch", isSlot: true, defaultPrice: 19.0 },
      { flag: "subBrandStory", priceKey: "priceBrandStory", label: "Brand Story Feature", typeKey: "brand_story", isSlot: false, defaultPrice: 0.0 },
      { flag: "subLoyalty", priceKey: "priceLoyalty", label: "Loyalty Points Program", typeKey: "loyalty", isSlot: false, defaultPrice: 0.0 },
      { flag: "subStamps", priceKey: "priceStamps", label: "Digital Stamps Program", typeKey: "stamps", isSlot: false, defaultPrice: 0.0 }
    ];

    const globalServices = [];
    let subtotal = 0;

    for (const sc of serviceConfigs) {
      if (tenant[sc.flag]) {
        const unitPrice = tenant[sc.priceKey] !== undefined && tenant[sc.priceKey] !== null
          ? Number(tenant[sc.priceKey])
          : sc.defaultPrice;

        const quantity = sc.isSlot ? Math.max(1, Number(tenant[sc.qtyKey] || 1)) : 1;
        const lineTotal = unitPrice * quantity;

        subtotal += lineTotal;
        globalServices.push({
          name: sc.label,
          typeKey: sc.typeKey,
          quantity,
          unitPrice,
          total: parseFloat(lineTotal.toFixed(2))
        });
      }
    }

    const vatPercentage = tenant.vatPercentage !== undefined ? Number(tenant.vatPercentage) : 15.0;
    const vatAmount = parseFloat((subtotal * (vatPercentage / 100)).toFixed(2));
    const totalAmount = parseFloat((subtotal + vatAmount).toFixed(2));

    // Create the persistent Monthly Subscription Invoice
    const invoice = await mainPrisma.tenantInvoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: `SUB-${tenant.slug.toUpperCase()}-${year}${monthNumStr}`,
        tenantId: tenant.id,
        type: "SUBSCRIPTION_MONTHLY",
        title: `Monthly Services Subscription (${monthName} ${year})`,
        status: "PENDING",
        subtotal: parseFloat(subtotal.toFixed(2)),
        vatPercentage,
        vatAmount,
        amount: totalAmount,
        currency: tenant.currency || "SAR",
        periodStart: monthStart,
        periodEnd: monthEnd,
        dueDate: monthStart,
        breakdown: {
          globalServices,
          branches: [],
          transactionFees: [],
          totalSubscription: parseFloat(subtotal.toFixed(2))
        },
        autoPaymentAttempts: 0,
        allowManualPayment: false // Hidden before first auto-attempt!
      }
    });

    // 3. Immediately trigger first automatic payment attempt
    try {
      await paymentService.attemptInvoicePayment(invoice.id, "AUTOMATIC");
    } catch (payErr) {
      console.error(`Auto payment error for ${invoice.id}:`, payErr.message);
    }

    generatedInvoices.push(invoice);
  }

  return generatedInvoices;
}

/**
 * Generate End-of-Month Service Transaction Fees Invoice (31st at 23:59 or last calendar day)
 */
async function generateMonthEndTransactionFeeInvoices(targetDate = new Date()) {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const monthNumStr = String(month + 1).padStart(2, "0");
  const monthName = targetDate.toLocaleDateString("en-US", { month: "long" });

  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const lastDay = getLastDayOfMonth(year, month);
  const monthEnd = new Date(year, month, lastDay, 23, 59, 59, 999);

  const tenants = await mainPrisma.tenant.findMany({
    where: { isActive: true }
  });

  const generatedInvoices = [];

  for (const tenant of tenants) {
    const invoiceId = `INV-${tenant.slug.toUpperCase()}-${year}${monthNumStr}-FEES`;

    // 1. Idempotency check: Do not duplicate
    const existing = await mainPrisma.tenantInvoice.findUnique({
      where: { id: invoiceId }
    });

    if (existing) {
      continue;
    }

    // 2. Fetch completed orders for the calendar month
    let periodOrders = [];
    try {
      periodOrders = await mainPrisma.aggregatedOrder.findMany({
        where: {
          tenantId: tenant.id,
          createdAt: { gte: monthStart, lte: monthEnd },
          status: "COMPLETED"
        }
      });
    } catch (err) {
      console.error(`Error fetching aggregated orders for ${tenant.slug}:`, err.message);
    }

    const feeConfigs = [
      { key: "feeAppServi", label: "APP servi", sourceMatch: (o) => o.source === "app" },
      { key: "feeAppBrand", label: "APP brand", sourceMatch: (o) => o.source === "app_brand" || o.type === "DELIVERY" },
      { key: "feePos", label: "POS Integration", sourceMatch: (o) => o.source === "pos" },
      { key: "feeQrTable", label: "QR Table Dining", sourceMatch: (o) => o.source === "qr_table" },
      { key: "feeQrCashier", label: "QR Cashier", sourceMatch: (o) => o.source === "qr_cashier" },
      { key: "feeKds", label: "KDS Screen", sourceMatch: (o) => o.source === "kds" },
      { key: "feeCds", label: "CDS Screen", sourceMatch: (o) => o.source === "cds" },
      { key: "feeBranch", label: "Physical Branches", sourceMatch: () => false }
    ];

    const transactionFeesList = [];
    let totalTransactionFees = 0;

    for (const fc of feeConfigs) {
      const defaultRate = tenant[fc.key] !== undefined && tenant[fc.key] !== null ? Number(tenant[fc.key]) : 0.0;
      const matchingOrders = periodOrders.filter(fc.sourceMatch);
      const salesVolume = matchingOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
      const feeAmount = matchingOrders.reduce((sum, o) => {
        const effectiveRate = (o.feeRate !== undefined && o.feeRate !== null && !isNaN(Number(o.feeRate)))
          ? Number(o.feeRate)
          : defaultRate;
        return sum + (Number(o.total || 0) * (effectiveRate / 100));
      }, 0);

      if (defaultRate > 0 || matchingOrders.length > 0 || fc.key === "feeAppServi" || fc.key === "feeAppBrand" || fc.key === "feePos") {
        totalTransactionFees += feeAmount;
        transactionFeesList.push({
          name: fc.label,
          feeRate: defaultRate,
          ordersCount: matchingOrders.length,
          salesVolume: parseFloat(salesVolume.toFixed(2)),
          feeAmount: parseFloat(feeAmount.toFixed(2))
        });
      }
    }

    const vatPercentage = tenant.vatPercentage !== undefined ? Number(tenant.vatPercentage) : 15.0;
    const vatAmount = parseFloat((totalTransactionFees * (vatPercentage / 100)).toFixed(2));
    const totalAmount = parseFloat((totalTransactionFees + vatAmount).toFixed(2));

    const invoice = await mainPrisma.tenantInvoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: `FEE-${tenant.slug.toUpperCase()}-${year}${monthNumStr}`,
        tenantId: tenant.id,
        type: "TRANSACTION_FEES",
        title: `Service Transaction Fees (${monthName} ${year})`,
        status: "PENDING",
        subtotal: parseFloat(totalTransactionFees.toFixed(2)),
        vatPercentage,
        vatAmount,
        amount: totalAmount,
        currency: tenant.currency || "SAR",
        periodStart: monthStart,
        periodEnd: monthEnd,
        dueDate: monthEnd,
        breakdown: {
          transactionFees: transactionFeesList,
          totalTransactionFees: parseFloat(totalTransactionFees.toFixed(2))
        },
        autoPaymentAttempts: 0,
        allowManualPayment: false
      }
    });

    // Immediately trigger first automatic payment attempt
    try {
      await paymentService.attemptInvoicePayment(invoice.id, "AUTOMATIC");
    } catch (payErr) {
      console.error(`Auto payment error for ${invoice.id}:`, payErr.message);
    }

    generatedInvoices.push(invoice);
  }

  return generatedInvoices;
}

/**
 * Generate a separate mid-month add-on fee invoice for newly added service only
 * Does NOT modify previously issued invoices.
 * Does NOT re-bill existing services.
 */
async function generateMidMonthAddonInvoice(tenantId, item) {
  const tenant = await mainPrisma.tenant.findUnique({
    where: { id: tenantId }
  });

  if (!tenant) throw new Error("Tenant not found");

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = getLastDayOfMonth(year, month);
  const monthEnd = new Date(year, month, lastDay, 23, 59, 59, 999);

  // Calculate prorated / remaining days for current month
  const totalDays = lastDay;
  const remainingDays = Math.max(1, (lastDay - now.getDate()) + 1);
  const prorationRatio = remainingDays / totalDays;

  const quantity = Number(item.quantity || 1);
  const unitPrice = Number(item.pricePerUnit || item.price || 0);
  const fullCost = unitPrice * quantity;
  const subtotal = parseFloat((fullCost * prorationRatio).toFixed(2));

  const vatPercentage = tenant.vatPercentage !== undefined ? Number(tenant.vatPercentage) : 15.0;
  const vatAmount = parseFloat((subtotal * (vatPercentage / 100)).toFixed(2));
  const totalAmount = parseFloat((subtotal + vatAmount).toFixed(2));

  const uniqueSuffix = `${Date.now().toString(36).toUpperCase()}`;
  const invoiceId = `INV-${tenant.slug.toUpperCase()}-${year}${String(month + 1).padStart(2, "0")}-ADDON-${(item.serviceType || "SVC").toUpperCase()}-${uniqueSuffix}`;

  const invoice = await mainPrisma.tenantInvoice.create({
    data: {
      id: invoiceId,
      invoiceNumber: `ADDON-${tenant.slug.toUpperCase()}-${uniqueSuffix}`,
      tenantId: tenant.id,
      type: "MID_MONTH_ADDON",
      title: `Service Add-on: ${item.label || item.serviceType} (${quantity} unit(s))`,
      status: "PENDING",
      subtotal,
      vatPercentage,
      vatAmount,
      amount: totalAmount,
      currency: tenant.currency || "SAR",
      periodStart: now,
      periodEnd: monthEnd,
      dueDate: now,
      breakdown: {
        globalServices: [
          {
            id: `addon_${(item.serviceType || "svc").toLowerCase()}_${Date.now()}`,
            name: item.label || item.serviceType,
            typeKey: (item.serviceType || "svc").toLowerCase(),
            serviceType: item.serviceType,
            quantity,
            price: unitPrice,
            unitPrice,
            amount: subtotal,
            total: subtotal,
            daysActive: remainingDays,
            remainingDays,
            proratedDays: remainingDays,
            totalDays,
            period: `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${monthEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
            prorated: true
          }
        ],
        branches: [],
        transactionFees: []
      },
      autoPaymentAttempts: 0,
      allowManualPayment: false
    }
  });

  // Immediately attempt automatic charge
  try {
    await paymentService.attemptInvoicePayment(invoice.id, "AUTOMATIC");
  } catch (payErr) {
    console.error(`Auto payment error for mid-month addon ${invoice.id}:`, payErr.message);
  }

  return invoice;
}

/**
 * Get all invoices with payment records and retry information
 */
async function getInvoices(filters = {}) {
  // Guarantee current month base invoices exist
  const existingCount = await mainPrisma.tenantInvoice.count();
  if (existingCount === 0) {
    await generateMonthlyRecurringInvoices();
  }

  const where = {};
  if (filters.tenantId) {
    where.tenantId = filters.tenantId;
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.type) {
    where.type = filters.type;
  }

  const invoices = await mainPrisma.tenantInvoice.findMany({
    where,
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          isActive: true
        }
      },
      payments: {
        orderBy: { createdAt: "desc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return invoices.map(inv => {
    const startStr = new Date(inv.periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const endStr = new Date(inv.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const isPaid = inv.status === "PAID";
    const isFailed = inv.status === "PAYMENT_FAILED";

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      tenantId: inv.tenantId,
      tenantName: inv.tenant?.name || "Brand",
      tenantSlug: inv.tenant?.slug || "",
      plan: inv.title || "Subscription",
      type: inv.type,
      period: `${startStr} - ${endStr}`,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      dueDate: inv.dueDate,
      amount: inv.amount,
      subtotal: inv.subtotal,
      vatPercentage: inv.vatPercentage,
      vatAmount: inv.vatAmount,
      subscriptionAmount: inv.type === "TRANSACTION_FEES" ? 0 : inv.subtotal,
      status: isPaid ? "paid" : (isFailed ? "overdue" : "pending"),
      dbStatus: inv.status,
      autoPaymentAttempts: inv.autoPaymentAttempts,
      allowManualPayment: inv.allowManualPayment,
      nextRetryAt: inv.nextRetryAt,
      lastPaymentError: inv.lastPaymentError,
      paidAt: inv.paidAt,
      createdAt: inv.createdAt,
      breakdown: inv.breakdown || {},
      payments: inv.payments || []
    };
  });
}

module.exports = {
  generateMonthlyRecurringInvoices,
  generateMonthEndTransactionFeeInvoices,
  generateMidMonthAddonInvoice,
  getInvoices,
  getLastDayOfMonth
};
