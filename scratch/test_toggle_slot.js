const mainPrisma = require("../src/config/prisma");
const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function main() {
  console.log("🔍 Fetching invoices for all tenants...");
  const invoices = await tenantsService.getInvoices({});
  const bkInvoice = invoices.find(i => i.tenantName.toLowerCase().includes("burger king"));
  
  if (!bkInvoice) {
    console.log("❌ Burger King invoice not found");
    return;
  }

  const tenant = await mainPrisma.tenant.findFirst({ where: { name: { contains: "Burger King" } } });
  console.log(`\n🏢 Found Tenant: ${bkInvoice.tenantName} (ID: ${tenant.id})`);

  const posItems = bkInvoice.breakdown.globalServices.filter(i => i.typeKey === "pos");
  console.log("📋 POS Invoice Items:");
  posItems.forEach((item, idx) => {
    console.log(`  [${idx + 1}] ID: ${item.id} | Name: ${item.name} | isCanceled: ${item.isCanceled} | assignedDevice: ${item.assignedDevice ? item.assignedDevice.name + " (isActive: " + item.assignedDevice.isActive + ")" : "Unassigned"}`);
  });

  const targetItem = posItems.find(i => i.assignedDevice);
  if (targetItem) {
    console.log(`\n🔄 Toggling slot "${targetItem.name}" (deviceId: ${targetItem.assignedDevice.id}) to ACTIVE = FALSE...`);
    const toggleRes = await tenantsService.toggleSlot(
      tenant.id,
      targetItem.typeKey,
      targetItem.slotIndex,
      false,
      targetItem.assignedDevice.id
    );
    console.log("✅ Toggle result:", toggleRes);

    console.log("\n🔍 Refetching invoices after toggle...");
    const updatedInvoices = await tenantsService.getInvoices({});
    const updatedBkInvoice = updatedInvoices.find(i => i.id === bkInvoice.id);
    const updatedPosItems = updatedBkInvoice.breakdown.globalServices.filter(i => i.typeKey === "pos");
    console.log("📋 Updated POS Invoice Items:");
    updatedPosItems.forEach((item, idx) => {
      console.log(`  [${idx + 1}] ID: ${item.id} | Name: ${item.name} | isCanceled: ${item.isCanceled} | assignedDevice: ${item.assignedDevice ? item.assignedDevice.name + " (isActive: " + item.assignedDevice.isActive + ")" : "Unassigned"}`);
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
