const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const ordersService = require("../src/app/orders/orders.service");
const loyaltyService = require("../src/web/tenant/loyalty/loyalty.service");

async function seedAppServiOrders() {
  console.log("🌱 Starting App Servi orders seeding...");

  // 1. Get tenant (burgerking or first active tenant)
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
  console.log(`📍 Using Tenant: ${tenant.name} (${tenant.id}, slug: ${tenant.slug})`);

  const tenantDb = getTenantClient(tenant.dbUrl);

  // 2. Get active branch
  const branch = await tenantDb.branch.findFirst({
    where: { ordersEnabled: true }
  });
  if (!branch) {
    console.error("❌ No open branch found!");
    process.exit(1);
  }
  console.log(`🏪 Using Branch: ${branch.name} (${branch.id})`);

  // 3. Get menu items
  const menuItems = await tenantDb.menuItem.findMany({
    where: { isAvailable: true },
    take: 3
  });
  if (menuItems.length === 0) {
    console.error("❌ No menu items found!");
    process.exit(1);
  }
  console.log(`🍔 Found ${menuItems.length} menu items:`, menuItems.map(m => `${m.name} ($${m.price})`).join(", "));

  // 4. Get or create test app user (Customer)
  let customerPhone = "+966555123456";
  let customer = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: customerPhone },
        { email: "faisal.test@burgerking.com" }
      ]
    }
  });
  if (!customer) {
    customer = await mainPrisma.appUser.create({
      data: {
        phone: customerPhone,
        name: "Faisal Test Customer",
        email: `faisal.test.${Date.now()}@burgerking.com`
      }
    });
    console.log(`👤 Created test customer: ${customer.name} (${customer.id})`);
  } else {
    console.log(`👤 Found test customer: ${customer.name} (${customer.id})`);
  }

  // Ensure wallet exists
  let wallet = await mainPrisma.wallet.findUnique({
    where: { appUserId: customer.id }
  });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customer.id, points: 0, lifetimeEarn: 0 }
    });
  }
  console.log(`💳 Customer wallet points balance: ${wallet.points}`);

  // 5. Seed 3 App Servi orders
  const createdOrders = [];
  for (let i = 1; i <= 3; i++) {
    const item = menuItems[(i - 1) % menuItems.length];
    const orderData = {
      branchId: branch.id,
      type: "TAKEAWAY",
      source: "app", // App Servi!
      paymentMethod: "cash",
      customerName: customer.name,
      customerPhone: customer.phone,
      items: [
        {
          menuItemId: item.id,
          quantity: i
        }
      ],
      notes: `App Servi Seeded Order #${i}`
    };

    const order = await ordersService.placeOrder(
      tenantDb,
      customer.id,
      orderData,
      tenant.id,
      tenant
    );
    console.log(`✅ Placed App Servi Order #${i}: ${order.orderNumber} (ID: ${order.id}) Total: SAR ${order.total}`);

    // Update order status to COMPLETED so points are earned!
    const tenantOrdersService = require("../src/web/tenant/orders/orders.service");
    const completedOrder = await tenantOrdersService.updateStatus(
      tenantDb,
      order.id,
      "COMPLETED",
      tenant.id,
      `Completed App Servi Order #${i}`
    );
    console.log(`🎉 Completed Order ${completedOrder.orderNumber} and awarded points.`);
    createdOrders.push(completedOrder);
  }

  // Re-fetch customer wallet
  wallet = await mainPrisma.wallet.findUnique({
    where: { appUserId: customer.id }
  });
  console.log(`\n💳 Updated Customer Wallet Points: ${wallet.points}`);
  console.log(`\n✨ Successfully seeded ${createdOrders.length} App Servi orders for testing refund & points reversal!`);
}

seedAppServiOrders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  });
