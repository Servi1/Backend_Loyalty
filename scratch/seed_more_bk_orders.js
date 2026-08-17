const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const tenantOrdersService = require("../src/web/tenant/orders/orders.service");

async function seedMoreBurgerKingOrders() {
  console.log("🍔 Seeding rich batch of new orders for Burger King...\n");

  const bkTenant = await mainPrisma.tenant.findFirst({
    where: { name: { contains: "Burger", mode: "insensitive" } }
  });

  if (!bkTenant) {
    console.error("❌ Burger King tenant not found!");
    process.exit(1);
  }

  const bkDb = getTenantClient(bkTenant.dbUrl);

  const customer = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555123456" },
        { phone: "966555123456" }
      ]
    }
  });

  const branch = await bkDb.branch.findFirst({ where: { ordersEnabled: true } });
  if (!branch) {
    console.error("❌ Active branch not found!");
    process.exit(1);
  }

  const menuItems = await bkDb.menuItem.findMany({ take: 10 });
  if (!menuItems || menuItems.length === 0) {
    console.error("❌ No menu items found for Burger King!");
    process.exit(1);
  }

  // 12 Realistic Orders across different channels & statuses
  const newOrderSpecs = [
    // Completed Orders (Eligible for transaction fees)
    { status: "COMPLETED", type: "DINE_IN", source: "app", items: [{ idx: 0, qty: 2 }, { idx: 1, qty: 1 }], desc: "Dine-in Order via App servi" },
    { status: "COMPLETED", type: "TAKEAWAY", source: "pos", items: [{ idx: 2, qty: 1 }], desc: "Takeaway Order via POS Counter" },
    { status: "COMPLETED", type: "DINE_IN", source: "qr_table", items: [{ idx: 1, qty: 2 }, { idx: 3, qty: 1 }], desc: "Dine-in Order via QR Table Dining" },
    { status: "COMPLETED", type: "TAKEAWAY", source: "qr_cashier", items: [{ idx: 0, qty: 1 }, { idx: 2, qty: 2 }], desc: "Express Pickup via QR Cashier Counter" },
    { status: "COMPLETED", type: "DELIVERY", source: "app", items: [{ idx: 4, qty: 2 }], desc: "Home Delivery via App servi" },
    { status: "COMPLETED", type: "DINE_IN", source: "pos", items: [{ idx: 1, qty: 3 }], desc: "Family Meal via POS Terminal" },

    // Non-Completed Orders (Excluded from transaction fees)
    { status: "PENDING", type: "TAKEAWAY", source: "app", items: [{ idx: 0, qty: 1 }], desc: "Pending App Order" },
    { status: "ACCEPTED", type: "DINE_IN", source: "qr_table", items: [{ idx: 2, qty: 1 }], desc: "Kitchen Accepted QR Order" },
    { status: "PREPARING", type: "DINE_IN", source: "pos", items: [{ idx: 3, qty: 2 }], desc: "Currently Preparing in Kitchen" },
    { status: "READY", type: "TAKEAWAY", source: "qr_cashier", items: [{ idx: 1, qty: 1 }], desc: "Ready for Pickup Counter" },
    { status: "CANCELLED", type: "DELIVERY", source: "app", items: [{ idx: 4, qty: 1 }], desc: "Cancelled Delivery Order (Zero Fee)" },
    { status: "REFUNDED", type: "DINE_IN", source: "pos", items: [{ idx: 0, qty: 2 }], desc: "Refunded POS Order (Zero Fee)" },
  ];

  console.log(`Seeding ${newOrderSpecs.length} new orders for tenant "${bkTenant.name}" (ID: ${bkTenant.id})...\n`);

  const summary = [];

  for (let i = 0; i < newOrderSpecs.length; i++) {
    const spec = newOrderSpecs[i];
    
    // Build items payload
    const itemsPayload = spec.items.map(it => {
      const menuItem = menuItems[it.idx % menuItems.length];
      return {
        menuItemId: menuItem.id,
        quantity: it.qty,
        price: Number(menuItem.price)
      };
    });

    // 1. Create initial order
    const order = await tenantOrdersService.create(
      bkDb,
      {
        branchId: branch.id,
        type: spec.type,
        source: spec.source,
        paymentMethod: "cash",
        customerPhone: customer?.phone || "+966555123456",
        customerId: customer?.id || null,
        items: itemsPayload,
        notes: `BK Seed — ${spec.desc}`
      },
      bkTenant.id
    );

    // 2. Set target status
    const updatedOrder = await tenantOrdersService.updateStatus(
      bkDb,
      order.id,
      spec.status,
      bkTenant.id,
      `Updated status to ${spec.status}`
    );

    const isCompleted = updatedOrder.status === "COMPLETED";
    const feeRate = Number(updatedOrder.feeRate || 0);
    const calculatedFee = isCompleted ? (updatedOrder.total * feeRate) / 100 : 0;

    summary.push({
      orderNumber: updatedOrder.orderNumber,
      source: updatedOrder.source,
      status: updatedOrder.status,
      total: `${updatedOrder.total.toFixed(2)} SAR`,
      feeRate: `${feeRate}%`,
      feeAmount: isCompleted ? `${calculatedFee.toFixed(2)} SAR` : "0.00 SAR (Exempt)",
      feeEligible: isCompleted ? "YES" : "NO"
    });

    console.log(`  ✅ Order ${updatedOrder.orderNumber} | Status: ${updatedOrder.status} | Source: ${updatedOrder.source} | Total: ${updatedOrder.total.toFixed(2)} SAR | Fee Charged: ${isCompleted ? calculatedFee.toFixed(2) + " SAR" : "0.00 SAR (Exempt)"}`);
  }

  console.log("\n=======================================================================================");
  console.log("📊 BURGER KING SEEDED ORDERS FEE MATRIX");
  console.log("=======================================================================================");
  console.table(summary);
  console.log("\n✨ Successfully seeded Burger King orders! Verified: Non-completed orders incur 0.00 SAR fees.");
}

seedMoreBurgerKingOrders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Burger King order seeding failed:", err);
    process.exit(1);
  });
