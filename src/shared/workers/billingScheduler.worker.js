const mainPrisma = require("../../config/prisma");
const billingService = require("../../services/billing.service");
const paymentService = require("../../services/payment.service");

let isRunning = false;

async function runBillingSchedulerCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const lastDay = billingService.getLastDayOfMonth(currentYear, currentMonth);

    // 1. Check 1st of month: Generate recurring monthly invoices
    if (currentDay === 1 && currentHour === 0 && currentMinute <= 10) {
      console.log("[Billing Scheduler] 1st of month detected: Generating monthly recurring invoices...");
      await billingService.generateMonthlyRecurringInvoices(now).catch(err => {
        console.error("[Billing Scheduler] Monthly invoice generation error:", err.message);
      });
    }

    // 2. Check end of month (31st at 23:59 or last calendar day)
    if (currentDay === lastDay && currentHour === 23 && currentMinute >= 55) {
      console.log(`[Billing Scheduler] Month-end detected (Day ${currentDay}): Processing service transaction fees...`);
      await billingService.generateMonthEndTransactionFeeInvoices(now).catch(err => {
        console.error("[Billing Scheduler] Month-end fee generation error:", err.message);
      });
    }

    // 3. Process automated 24-hour payment retries
    const pendingRetryInvoices = await mainPrisma.tenantInvoice.findMany({
      where: {
        status: "PAYMENT_FAILED",
        autoPaymentAttempts: { lt: 3 },
        nextRetryAt: { lte: now }
      }
    });

    if (pendingRetryInvoices.length > 0) {
      console.log(`[Billing Scheduler] Found ${pendingRetryInvoices.length} invoices due for automatic 24-hour retry.`);
      for (const inv of pendingRetryInvoices) {
        try {
          console.log(`[Billing Scheduler] Executing retry attempt #${inv.autoPaymentAttempts + 1} for invoice ${inv.id}...`);
          await paymentService.attemptInvoicePayment(inv.id, "AUTOMATIC");
        } catch (retryErr) {
          console.error(`[Billing Scheduler] Retry failed for invoice ${inv.id}:`, retryErr.message);
        }
      }
    }
  } catch (err) {
    console.error("[Billing Scheduler] Cycle error:", err.message);
  } finally {
    isRunning = false;
  }
}

function startBillingScheduler() {
  console.log("[Billing Scheduler Worker] Initialized.");
  // Run initial check after 3 seconds
  setTimeout(runBillingSchedulerCycle, 3000);
  // Run interval every 60 seconds
  setInterval(runBillingSchedulerCycle, 60 * 1000);
}

module.exports = {
  runBillingSchedulerCycle,
  startBillingScheduler
};

