const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function testInvoicesSlots() {
  console.log("🧪 Testing Slot-based Prorated Billing & Invoices...");

  const invoices = await tenantsService.getInvoices();
  console.log(`\n📄 Generated ${invoices.length} invoices across active brands:`);

  invoices.forEach((inv) => {
    console.log(`\n=================================================`);
    console.log(`Brand: ${inv.tenantName} | Period: ${inv.period} | Invoice ID: ${inv.id}`);
    console.log(`Subscription Amount: SAR ${inv.subscriptionAmount} | Total Billed: SAR ${inv.amount}`);
    console.log(`Global & Slot Services:`);
    console.table(inv.breakdown.globalServices);
  });

  console.log("\n✨ Invoices test completed successfully!");
}

testInvoicesSlots()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
