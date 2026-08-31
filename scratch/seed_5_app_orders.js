const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const ordersService = require("../src/app/orders/orders.service");
const tenantsService = require("../src/web/admin/tenants/tenants.service");

async function seedFiveAppOrders() {
  console.log("🚀 Starting seeding 5 App orders with real customers & points...");

  // 1. Get active tenant
  let tenant = await mainPrisma.tenant.findFirst({
    where: { slug: "burgerking" }
  });
  if (!tenant) {
    tenant = await mainPrisma.tenant.findFirst({
      where: { isActive: true }
    });
  }
  if (!tenant) {
    console.error("❌ No active tenant found!");
    process.exit(1);
  }
  console.log(`📍 Tenant: ${tenant.name} (${tenant.id}, slug: ${tenant.slug})`);

  const tenantDb = getTenantClient(tenant.dbUrl);

  // 2. Get active branch
  const branch = await tenantDb.branch.findFirst({});
  if (!branch) {
    console.error("❌ No branch found!");
    process.exit(1);
  }
  console.log(`🏪 Branch: ${branch.name} (${branch.id})`);

  // 3. Get menu items
  const menuItems = await tenantDb.menuItem.findMany({
    take: 5
  });
  if (menuItems.length === 0) {
    console.error("❌ No menu items found!");
    process.exit(1);
  }
  console.log(`🍔 Found ${menuItems.length} menu items.`);

  // 4. Find or prepare real customer with points
  let customer = await mainPrisma.appUser.findFirst({
    where: {
      phone: { not: "" }
    },
    include: { wallet: true }
  });

  if (!customer) {
    customer = await mainPrisma.appUser.create({
      data: {
        name: "Mansoor Ali",
        phone: "+966550505994",
        email: "mansoor.ali@example.com"
      },
      include: { wallet: true }
    });
  }

  // Ensure customer name is updated if it was "test"
  if (!customer.name || customer.name.toLowerCase() === "test" || customer.name === "Guest Customer") {
    customer = await mainPrisma.appUser.update({
      where: { id: customer.id },
      data: { name: "Mansoor Ali" },
      include: { wallet: true }
    });
  }

  // Ensure wallet has ample 100,000 points balance for buying with points
  let wallet = customer.wallet;
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customer.id, points: 100000, lifetimeEarn: 100000 }
    });
  } else {
    wallet = await mainPrisma.wallet.update({
      where: { appUserId: customer.id },
      data: { points: 100000, lifetimeEarn: wallet.lifetimeEarn + 50000 }
    });
  }

  console.log(`👤 Customer: ${customer.name} (${customer.phone}) | Initial Wallet Balance: ${wallet.points} Points`);

  // 5. Seed 5 App orders with varied payment methods and points
  const orderConfigs = [
    { type: "TAKEAWAY", paymentMethod: "points", pointsRedeemed: 1200, notes: "App Order #1 - Paid with Loyalty Points" },
    { type: "DELIVERY", paymentMethod: "points", pointsRedeemed: 2400, notes: "App Order #2 - Paid with Loyalty Points" },
    { type: "DINE_IN", paymentMethod: "apple_pay", pointsRedeemed: null, notes: "App Order #3 - Paid with Apple Pay" },
    { type: "DELIVERY", paymentMethod: "card", pointsRedeemed: null, notes: "App Order #4 - Paid with Credit Card" },
    { type: "DELIVER_TO_CAR", paymentMethod: "points", pointsRedeemed: 1800, notes: "App Order #5 - Paid with Loyalty Points" },
  ];

  const createdOrders = [];

  for (let i = 0; i < orderConfigs.length; i++) {
    const config = orderConfigs[i];
    const item = menuItems[i % menuItems.length];
    const qty = (i % 2) + 1;

    const orderData = {
      branchId: branch.id,
      type: config.type,
      source: "app",
      paymentMethod: config.paymentMethod,
      customerName: customer.name,
      customerPhone: customer.phone,
      items: [
        {
          menuItemId: item.id,
          quantity: qty
        }
      ],
      notes: config.notes
    };

    // Create App order via official App service endpoint logic
    const order = await ordersService.placeOrder(
      tenantDb,
      customer.id,
      orderData,
      tenant.id,
      tenant
    );

    // Update status to COMPLETED so Super Admin tracking picks it up
    const updatedOrder = await tenantDb.order.update({
      where: { id: order.id },
      data: {
        status: "COMPLETED"
      }
    });

    console.log(`✅ Seeded App Order #${i + 1}: ${updatedOrder.orderNumber} | Type: ${updatedOrder.type} | Payment: ${updatedOrder.paymentMethod} | Points: ${updatedOrder.pointsRedeemed || 0} pts | Total: ${updatedOrder.total} SAR`);
    createdOrders.push(updatedOrder);
  }

  // 6. Trigger Super Admin aggregated orders sync
  console.log("\n🔄 Syncing newly seeded orders to Super Admin aggregated registry...");
  await tenantsService.syncAllTenantOrders();

  // Re-fetch customer wallet balance
  const updatedWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customer.id } });
  console.log(`\n💳 Final Customer Wallet Points Balance: ${updatedWallet.points} PTS`);
  console.log(`🎉 Successfully seeded ${createdOrders.length} App orders with real customer points!`);
}

seedFiveAppOrders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  });
