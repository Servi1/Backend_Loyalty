const mainPrisma = require("../config/prisma");

/**
 * Helper to resolve an invoice whether passed as base ID (INV-SLUG-YYYYMM)
 * or specific ID (INV-SLUG-YYYYMM-SUB or INV-SLUG-YYYYMM-FEES)
 */
async function resolveInvoice(invoiceId, typePreference = null) {
  let invoice = await mainPrisma.tenantInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      tenant: {
        include: {
          paymentMethods: {
            where: { status: "ACTIVE" },
            orderBy: { isDefault: "desc" },
            take: 1
          }
        }
      },
      payments: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (invoice) return invoice;

  // Try finding candidates matching prefix or suffix
  const candidates = await mainPrisma.tenantInvoice.findMany({
    where: {
      OR: [
        { id: `${invoiceId}-SUB` },
        { id: `${invoiceId}-FEES` },
        { id: { startsWith: invoiceId } }
      ]
    },
    include: {
      tenant: {
        include: {
          paymentMethods: {
            where: { status: "ACTIVE" },
            orderBy: { isDefault: "desc" },
            take: 1
          }
        }
      },
      payments: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (candidates.length === 0) return null;

  if (typePreference === "fee") {
    return candidates.find(c => c.id.endsWith("-FEES") || c.type === "TRANSACTION_FEES") || candidates[0];
  }
  return candidates.find(c => c.id.endsWith("-SUB") || c.type === "SUBSCRIPTION_MONTHLY") || candidates[0];
}

/**
 * Execute a payment attempt for a given invoice (Demo Mode engine)
 * @param {string} invoiceId 
 * @param {"AUTOMATIC" | "MANUAL"} attemptType 
 * @param {object} [manualPaymentDetails] - optional details when paying manually
 */
async function attemptInvoicePayment(invoiceId, attemptType = "AUTOMATIC", manualPaymentDetails = null) {
  const typePreference = manualPaymentDetails?.type || null;
  const invoice = await resolveInvoice(invoiceId, typePreference);

  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  if (invoice.status === "PAID") {
    return { success: true, message: "Invoice is already paid", invoice };
  }

  const currentAttemptNumber = (invoice.autoPaymentAttempts || 0) + 1;

  // 1. MANUAL PAYMENT FLOW
  if (attemptType === "MANUAL") {
    const methodType = manualPaymentDetails?.paymentMethod || "mada";
    const txnRef = `TXN-MANUAL-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    // Create payment attempt record
    await mainPrisma.tenantPaymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        attemptNumber: currentAttemptNumber,
        type: "MANUAL",
        status: "SUCCESS",
        amount: invoice.amount,
        paymentMethod: methodType,
        transactionReference: txnRef
      }
    });

    // Optionally save the card if requested
    if (manualPaymentDetails?.saveCard) {
      await saveTenantPaymentMethod(invoice.tenantId, {
        type: methodType,
        brand: manualPaymentDetails.cardBrand || (methodType === "mada" ? "Mada" : "Visa"),
        last4: manualPaymentDetails.last4 || "4242",
        expiryMonth: manualPaymentDetails.expiryMonth || 12,
        expiryYear: manualPaymentDetails.expiryYear || 2028,
        cardholder: manualPaymentDetails.cardholder || invoice.tenant.name
      });
    }

    // Update invoice to PAID, clear retries and hide manual button
    const updatedInvoice = await mainPrisma.tenantInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        allowManualPayment: false,
        nextRetryAt: null,
        lastPaymentError: null
      },
      include: { payments: true }
    });

    return {
      success: true,
      status: "PAID",
      transactionReference: txnRef,
      invoice: updatedInvoice
    };
  }

  // 2. AUTOMATIC PAYMENT FLOW
  const savedMethod = invoice.tenant.paymentMethods && invoice.tenant.paymentMethods.length > 0
    ? invoice.tenant.paymentMethods[0]
    : null;

  // Case 2A: No saved payment method on file
  if (!savedMethod) {
    const failureReason = "No saved payment method on file";
    const nextAttempts = (invoice.autoPaymentAttempts || 0) + 1;
    const canRetry = nextAttempts < 3;
    const nextRetryDate = canRetry ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    await mainPrisma.tenantPaymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        attemptNumber: nextAttempts,
        type: "AUTOMATIC",
        status: "FAILED",
        amount: invoice.amount,
        failureReason
      }
    });

    const updatedInvoice = await mainPrisma.tenantInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAYMENT_FAILED",
        autoPaymentAttempts: nextAttempts,
        allowManualPayment: true, // Immediately show manual payment button on first failure!
        nextRetryAt: nextRetryDate,
        lastPaymentError: failureReason
      },
      include: { payments: true }
    });

    return {
      success: false,
      reason: failureReason,
      attemptNumber: nextAttempts,
      allowManualPayment: true,
      nextRetryAt: nextRetryDate,
      invoice: updatedInvoice
    };
  }

  // Case 2B: Saved payment method exists - check demo outcome simulation
  const outcome = savedMethod.demoSimulateOutcome || "SUCCESS";

  if (outcome !== "SUCCESS") {
    const failureReason = outcome === "FAIL_INSUFFICIENT_FUNDS"
      ? "Card declined: Insufficient funds (Demo Simulation)"
      : "Card declined by issuing bank (Demo Simulation)";

    const nextAttempts = (invoice.autoPaymentAttempts || 0) + 1;
    const canRetry = nextAttempts < 3;
    const nextRetryDate = canRetry ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    await mainPrisma.tenantPaymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        attemptNumber: nextAttempts,
        type: "AUTOMATIC",
        status: "FAILED",
        amount: invoice.amount,
        paymentMethod: savedMethod.type,
        failureReason
      }
    });

    const updatedInvoice = await mainPrisma.tenantInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAYMENT_FAILED",
        autoPaymentAttempts: nextAttempts,
        allowManualPayment: true, // Immediately show manual payment button!
        nextRetryAt: nextRetryDate,
        lastPaymentError: failureReason
      },
      include: { payments: true }
    });

    return {
      success: false,
      reason: failureReason,
      attemptNumber: nextAttempts,
      allowManualPayment: true,
      nextRetryAt: nextRetryDate,
      invoice: updatedInvoice
    };
  }

  // Case 2C: Automatic Payment Succeeded
  const txnRef = `TXN-AUTO-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  await mainPrisma.tenantPaymentAttempt.create({
    data: {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      attemptNumber: currentAttemptNumber,
      type: "AUTOMATIC",
      status: "SUCCESS",
      amount: invoice.amount,
      paymentMethod: savedMethod.type,
      transactionReference: txnRef
    }
  });

  const updatedInvoice = await mainPrisma.tenantInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      allowManualPayment: false, // Hide manual payment button
      nextRetryAt: null,
      lastPaymentError: null
    },
    include: { payments: true }
  });

  return {
    success: true,
    status: "PAID",
    transactionReference: txnRef,
    invoice: updatedInvoice
  };
}

/**
 * Save or update default payment method for a tenant
 */
async function saveTenantPaymentMethod(tenantId, cardData) {
  const tenant = await mainPrisma.tenant.findFirst({
    where: { OR: [{ id: tenantId }, { slug: tenantId }] }
  });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  const resolvedTenantId = tenant.id;

  // Mark existing cards as non-default
  await mainPrisma.tenantPaymentMethod.updateMany({
    where: { tenantId: resolvedTenantId },
    data: { isDefault: false }
  });

  const paymentMethod = await mainPrisma.tenantPaymentMethod.create({
    data: {
      tenantId: resolvedTenantId,
      type: cardData.type || "card",
      brand: cardData.brand || "Visa",
      last4: cardData.last4 || "4242",
      expiryMonth: Number(cardData.expiryMonth || 12),
      expiryYear: Number(cardData.expiryYear || 2028),
      cardholder: cardData.cardholder || "Brand Owner",
      gatewayToken: `tok_${Date.now()}`,
      isDefault: true,
      status: "ACTIVE",
      demoSimulateOutcome: cardData.demoSimulateOutcome || "SUCCESS"
    }
  });

  return paymentMethod;
}

/**
 * Get payment methods for a tenant
 */
async function getTenantPaymentMethods(tenantId) {
  const tenant = await mainPrisma.tenant.findFirst({
    where: { OR: [{ id: tenantId }, { slug: tenantId }] }
  });
  if (!tenant) return [];
  return mainPrisma.tenantPaymentMethod.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Fast-forward 24h retry immediately (Demo testing tool)
 */
async function fastForwardRetry(invoiceId, typePreference = null) {
  const invoice = await resolveInvoice(invoiceId, typePreference);

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.status === "PAID") return { message: "Invoice already paid", invoice };

  return attemptInvoicePayment(invoice.id, "AUTOMATIC");
}

/**
 * Update demo simulation outcome for testing
 */
async function setDemoSimulateOutcome(tenantId, outcome) {
  const methods = await mainPrisma.tenantPaymentMethod.findMany({
    where: { tenantId }
  });

  if (methods.length === 0) {
    // Create a demo method if none exists
    await saveTenantPaymentMethod(tenantId, {
      type: "mada",
      brand: "Mada",
      last4: "4242",
      demoSimulateOutcome: outcome
    });
  } else {
    await mainPrisma.tenantPaymentMethod.updateMany({
      where: { tenantId },
      data: { demoSimulateOutcome: outcome }
    });
  }

  return { success: true, outcome };
}

/**
 * Reset an invoice back to unpaid / payment failed for demo testing
 */
async function resetInvoicePayment(invoiceId, targetType = null) {
  let invoice = await mainPrisma.tenantInvoice.findUnique({
    where: { id: invoiceId }
  });

  const targets = [];
  if (invoice) {
    targets.push(invoice);
  } else {
    const candidates = await mainPrisma.tenantInvoice.findMany({
      where: {
        OR: [
          { id: `${invoiceId}-SUB` },
          { id: `${invoiceId}-FEES` },
          { id: { startsWith: invoiceId } }
        ]
      }
    });

    if (candidates.length === 0) {
      return { success: true, message: `No invoice record found to reset for ${invoiceId}` };
    }

    if (targetType === "fee") {
      const match = candidates.find(c => c.id.endsWith("-FEES") || c.type === "TRANSACTION_FEES");
      if (match) targets.push(match);
      else targets.push(candidates[0]);
    } else if (targetType === "sub") {
      const match = candidates.find(c => c.id.endsWith("-SUB") || c.type === "SUBSCRIPTION_MONTHLY");
      if (match) targets.push(match);
      else targets.push(candidates[0]);
    } else {
      targets.push(...candidates);
    }
  }

  const nextRetryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const updatedInvoices = [];

  for (const inv of targets) {
    // Remove existing payments for clean reset
    await mainPrisma.tenantPaymentAttempt.deleteMany({
      where: { invoiceId: inv.id }
    });

    const updated = await mainPrisma.tenantInvoice.update({
      where: { id: inv.id },
      data: {
        status: "PAYMENT_FAILED",
        paidAt: null,
        autoPaymentAttempts: 1,
        allowManualPayment: true, // Immediately show manual payment button on reset!
        nextRetryAt: nextRetryDate,
        lastPaymentError: "Payment reset to unpaid for demo testing"
      },
      include: { payments: true }
    });
    updatedInvoices.push(updated);
  }

  return { success: true, invoice: updatedInvoices[0], invoices: updatedInvoices };
}

module.exports = {
  attemptInvoicePayment,
  saveTenantPaymentMethod,
  getTenantPaymentMethods,
  fastForwardRetry,
  setDemoSimulateOutcome,
  resetInvoicePayment
};

