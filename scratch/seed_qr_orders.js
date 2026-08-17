const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const tenantOrdersService = require("../src/web/tenant/orders/orders.service");

async function seedQrOrders() {
  console.log("🔍 Checking updated Burger King tenant transaction fee configuration...\n");

  const burgerKingTenant = await mainPrisma.tenant.findFirst({
    where: { slug: "burgerking" }
  });

  if (!burgerKingTenant) {
    console.error("❌ Burger King tenant not found!");
    process.exit(1);
  }

  console.log(`📌 Tenant Fee Rates:`);
  console.log(`   - QR Table Fee (feeQrTable): ${burgerKingTenant.feeQrTable}%`);
  console.log(`   - QR Cashier Fee (feeQrCashier): ${burgerKingTenant.feeQrCashier}%`);
  console.log(`   - App Servi Fee (feeAppServi): ${burgerKingTenant.feeAppServi}%`);
  console.log(`   - App Brand Fee (feeAppBrand): ${burgerKingTenant.feeAppBrand}%`);
  console.log(`   - POS Fee (feePos): ${burgerKingTenant.feePos}%\n`);

  const bkDb = getTenantClient(burgerKingTenant.dbUrl);

  let customer = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555123456" },
        { email: "faisal.test@burgerking.com" }
      ]
    }
  });

  const branch = await bkDb.branch.findFirst({ where: { ordersEnabled: true } });
  const menuItems = await bkDb.menuItem.findMany({ take: 3 });

  const qrScenarios = [
    // 3 QR Table Dining orders
    { channel: "qr_table", type: "DINE_IN", label: "QR Table Dining #1", price: 25.0 },
    { channel: "qr_table", type: "DINE_IN", label: "QR Table Dining #2", price: 40.0 },
    { channel: "qr_table", type: "DINE_IN", label: "QR Table Dining #3", price: 50.0 },

    // 3 QR Cashier orders
    { channel: "qr_cashier", type: "TAKEAWAY", label: "QR Cashier Counter #1", price: 30.0 },
    { channel: "qr_cashier", type: "TAKEAWAY", label: "QR Cashier Counter #2", price: 45.0 },
    { channel: "qr_cashier", type: "TAKEAWAY", label: "QR Cashier Counter #3", price: 60.0 }
  ];

  console.log("🌱 Seeding 3 QR Table and 3 QR Cashier orders...");
  const results = [];

  for (let i = 0; i < qrScenarios.length; i++) {
    const sc = qrScenarios[i];
    const item = menuItems[i % menuItems.length];

    const createdOrder = await tenantOrdersService.create(
      bkDb,
      {
        branchId: branch.id,
        type: sc.type,
        source: sc.channel,
        paymentMethod: "cash",
        customerPhone: customer.phone,
        customerId: customer.id,
        items: [{ menuItemId: item.id, quantity: 1, price: sc.price }],
        notes: `QR Test Order — ${sc.label}`
      },
      burgerKingTenant.id
    );

    const completedOrder = await tenantOrdersService.updateStatus(
      bkDb,
      createdOrder.id,
      "COMPLETED",
      burgerKingTenant.id,
      `Completed — ${sc.label}`
    );

    const calcFee = (completedOrder.total * completedOrder.feeRate) / 100;

    results.push({
      orderNumber: completedOrder.orderNumber,
      channel: sc.channel,
      type: sc.type,
      total: completedOrder.total,
      feeRate: `${completedOrder.feeRate}%`,
      feeAmount: parseFloat(calcFee.toFixed(2))
    });

    console.log(`  ✅ [${sc.label}] ${completedOrder.orderNumber} | Total: SAR ${completedOrder.total} | Fee Rate: ${completedOrder.feeRate}% | Fee Amount: SAR ${calcFee.toFixed(2)}`);
  }

  console.log("\n========================================================");
  console.table(results);
  console.log("✨ QR orders seeded successfully with updated fee rates!");
}

seedQrOrders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ QR seeding script failed:", err);
    process.exit(1);
  });
