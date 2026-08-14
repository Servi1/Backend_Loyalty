const mainPrisma = require("../src/config/prisma");
const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function testAddSlotMidMonth() {
  console.log("🧪 Testing Mid-Month Slot Expansion (+1 POS Slot)...");

  // 1. Get Burger King tenant
  const bk = await mainPrisma.tenant.findFirst({ where: { slug: "burgerking" } });
  if (!bk) {
    console.error("❌ Burger King tenant not found!");
    process.exit(1);
  }

  console.log(`📌 Initial POS Slots for ${bk.name}: ${bk.posQuantity} slots`);

  // 2. Add +1 POS Slot mid-month today via update
  const newPosQty = (bk.posQuantity || 0) + 1;
  console.log(`➕ Updating POS Slots to ${newPosQty} slots...`);

  await tenantsService.update(bk.id, {
    posQuantity: newPosQty
  });

  // 3. Re-fetch invoices and inspect global services
  const invoices = await tenantsService.getInvoices();
  const currentInvoice = invoices.find(inv => inv.tenantName === bk.name && inv.period.includes("Aug"));

  console.log(`\n📄 Current Invoice for ${bk.name} (${currentInvoice.period}):`);
  console.log(`Subscription Amount: SAR ${currentInvoice.subscriptionAmount} | Total Billed: SAR ${currentInvoice.amount}`);
  console.log(`Breakdown Items:`);
  console.table(currentInvoice.breakdown.globalServices);

  console.log("\n✨ Mid-month slot expansion test complete!");
}

testAddSlotMidMonth()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
