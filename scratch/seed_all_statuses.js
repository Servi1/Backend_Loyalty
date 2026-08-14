const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const tenantOrdersService = require("../src/web/tenant/orders/orders.service");

async function seedAllStatuses() {
  console.log("🌱 Seeding test orders for ALL 8 OrderStatus values...\n");

  const burgerKingTenant = await mainPrisma.tenant.findFirst({
    where: { slug: "burgerking" }
  });

  if (!burgerKingTenant) {
    console.error("❌ Burger King tenant not found!");
    process.exit(1);
  }

  const bkDb = getTenantClient(burgerKingTenant.dbUrl);

  let customer = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555123456" },
        { phone: "966555123456" }
      ]
    }
  });

  const branch = await bkDb.branch.findFirst({ where: { ordersEnabled: true } });
  const menuItems = await bkDb.menuItem.findMany({ take: 5 });

  const statusConfigs = [
    { status: "HALTED", type: "DINE_IN", channel: "pos", price: 18.0, desc: "Order Halted on POS" },
    { status: "PENDING", type: "TAKEAWAY", channel: "app", price: 24.0, desc: "Order Pending Confirmation" },
    { status: "ACCEPTED", type: "DINE_IN", channel: "qr_table", price: 15.0, desc: "Order Accepted by Kitchen" },
    { status: "PREPARING", type: "DINE_IN", channel: "pos", price: 32.0, desc: "Order Currently Preparing" },
    { status: "READY", type: "TAKEAWAY", channel: "qr_cashier", price: 20.0, desc: "Order Ready for Pickup" },
    { status: "COMPLETED", type: "DINE_IN", channel: "app", price: 45.0, desc: "Order Fully Completed" },
    { status: "CANCELLED", type: "DELIVERY", channel: "app", price: 28.0, desc: "Order Cancelled by Customer" },
    { status: "REFUNDED", type: "DELIVER_TO_CAR", channel: "app", price: 35.0, desc: "Order Refunded to Customer" }
  ];

  const results = [];

  for (let idx = 0; idx < statusConfigs.length; idx++) {
    const cfg = statusConfigs[idx];
    const item = menuItems[idx % menuItems.length];

    // 1. Create order
    const createdOrder = await tenantOrdersService.create(
      bkDb,
      {
        branchId: branch.id,
        type: cfg.type,
        source: cfg.channel,
        paymentMethod: "cash",
        customerPhone: customer.phone,
        customerId: customer.id,
        items: [{ menuItemId: item.id, quantity: 1, price: cfg.price }],
        notes: `Status Seed — ${cfg.desc}`
      },
      burgerKingTenant.id
    );

    // 2. Set exact target status
    const updatedOrder = await tenantOrdersService.updateStatus(
      bkDb,
      createdOrder.id,
      cfg.status,
      burgerKingTenant.id,
      `Set status to ${cfg.status}`
    );

    results.push({
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      channel: updatedOrder.source,
      type: updatedOrder.type,
      total: updatedOrder.total,
      feeRate: `${updatedOrder.feeRate}%`,
      description: cfg.desc
    });

    console.log(`  ✅ [${updatedOrder.status}] ${updatedOrder.orderNumber} (${updatedOrder.source}/${updatedOrder.type}) | Total: SAR ${updatedOrder.total} | FeeRate: ${updatedOrder.feeRate}%`);
  }

  console.log("\n========================================================");
  console.log("📊 ALL ORDER STATUSES SEEDED MATRIX");
  console.log("========================================================");
  console.table(results);
  console.log("✨ All 8 order statuses successfully seeded!");
}

seedAllStatuses()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Status seeding script failed:", err);
    process.exit(1);
  });
