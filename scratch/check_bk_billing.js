const mainPrisma = require("../src/config/prisma");
const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function checkBkBilling() {
  console.log("🔍 Checking live Burger King billing invoice calculation...\n");

  const bk = await mainPrisma.tenant.findFirst({
    where: { name: { contains: "Burger", mode: "insensitive" } }
  });

  const invoices = await tenantsService.getInvoices(bk.id);
  const currentInvoice = invoices[0];
  
  console.log(`Burger King Tenant: "${bk.name}"`);
  console.log(`Current Invoice ID: ${currentInvoice.id} (${currentInvoice.period})`);
  console.log(`Total Invoice Amount: ${currentInvoice.amount.toFixed(2)} SAR`);
  console.log(`Subscription Fees: ${currentInvoice.subscriptionAmount.toFixed(2)} SAR`);
  console.log(`Transaction Fees: ${currentInvoice.breakdown.totalTransactionFees.toFixed(2)} SAR\n`);
  
  console.log("Service Transaction Fees Detailed Matrix:");
  console.table(currentInvoice.breakdown.transactionFees);
}

checkBkBilling()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Billing check failed:", err);
    process.exit(1);
  });
