const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const appOrdersService = require("../src/app/orders/orders.service");
const tenantOrdersService = require("../src/web/tenant/orders/orders.service");

async function executeFreshCleanupAndSeed() {
  console.log("🧹 Starting database cleanup and fresh order seeding...\n");

  // 1. Identify Burger King tenant
  const burgerKingTenant = await mainPrisma.tenant.findFirst({
    where: { slug: "burgerking" }
  });

  if (!burgerKingTenant) {
    console.error("❌ Burger King tenant (slug: burgerking) not found!");
    process.exit(1);
  }

  console.log(`📌 Found Burger King Tenant: ${burgerKingTenant.name} (${burgerKingTenant.id})`);

  // 2. Delete non-BurgerKing tenants from main database
  const otherTenants = await mainPrisma.tenant.findMany({
    where: { NOT: { id: burgerKingTenant.id } }
  });
  console.log(`🗑️ Removing ${otherTenants.length} other tenants (e.g. burgerking2, etc.)...`);
  for (const t of otherTenants) {
    await mainPrisma.aggregatedOrder.deleteMany({ where: { tenantId: t.id } });
    await mainPrisma.tenant.delete({ where: { id: t.id } });
    console.log(`   - Deleted tenant: ${t.name} (${t.id})`);
  }

  // 3. Clear all orders & aggregated orders in main database
  console.log("🗑️ Wiping all main database orders...");
  await mainPrisma.order.deleteMany({});
  await mainPrisma.aggregatedOrder.deleteMany({});

  // 4. Reset Customer Wallets & Points
  console.log("💳 Resetting all customer loyalty wallets and transactions...");
  await mainPrisma.walletTransaction.deleteMany({});
  await mainPrisma.wallet.updateMany({
    data: { points: 0, lifetimeEarn: 0 }
  });

  // 5. Connect to Burger King Tenant DB & Wipe Orders
  console.log("🍔 Cleaning Burger King tenant database orders & cart items...");
  const bkDb = getTenantClient(burgerKingTenant.dbUrl);

  try {
    await bkDb.orderItem.deleteMany({});
    await bkDb.order.deleteMany({});
    console.log("   ✅ Cleared all orders and order items in Burger King database.");
  } catch (err) {
    console.error("   ⚠️ Warning during BK orders cleanup:", err.message);
  }

  // Clear cart items in main Prisma
  await mainPrisma.cartItem.deleteMany({});

  // 6. Find or create test Customer
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
        email: "faisal.test@burgerking.com"
      }
    });
  }

  // Ensure wallet exists
  let wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customer.id } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: customer.id, points: 0, lifetimeEarn: 0 }
    });
  }

  console.log(`\n👤 Customer: ${customer.name} (${customer.phone}) | Initial Points: ${wallet.points}`);

  // 7. Find branch & menu items
  const branch = await bkDb.branch.findFirst({ where: { ordersEnabled: true } });
  const menuItems = await bkDb.menuItem.findMany({ where: { isAvailable: true }, take: 5 });

  if (!branch || menuItems.length === 0) {
    console.error("❌ Branch or menu items missing in Burger King!");
    process.exit(1);
  }

  console.log(`🏪 Branch: ${branch.name}`);
  console.log(`🍔 Menu items: ${menuItems.map(m => `${m.name} (SAR ${m.price})`).join(", ")}\n`);

  // 8. Define test orders matrix (All order channels & types except app_brand)
  const testScenarios = [
    { name: "App Servi — Dine In", source: "app", type: "DINE_IN", expectedFeeRate: 5.0 },
    { name: "App Servi — Takeaway", source: "app", type: "TAKEAWAY", expectedFeeRate: 5.0 },
    { name: "App Servi — Delivery", source: "app", type: "DELIVERY", expectedFeeRate: 5.0 },
    { name: "App Servi — Deliver to Car", source: "app", type: "DELIVER_TO_CAR", expectedFeeRate: 5.0 },
    { name: "App Servi — Scheduled", source: "app", type: "SCHEDULED", expectedFeeRate: 5.0 },
    { name: "POS Terminal — Dine In", source: "pos", type: "DINE_IN", expectedFeeRate: 5.2 },
    { name: "QR Table — Dine In", source: "qr_table", type: "DINE_IN", expectedFeeRate: 0.0 },
    { name: "QR Cashier — Takeaway", source: "qr_cashier", type: "TAKEAWAY", expectedFeeRate: 0.0 }
  ];

  console.log("🌱 Seeding test orders across all channels & types...");

  const seededResults = [];

  for (let idx = 0; idx < testScenarios.length; idx++) {
    const sc = testScenarios[idx];
    const item = menuItems[idx % menuItems.length];
    const quantity = 1 + (idx % 2);

    let createdOrder;
    if (sc.source === "app") {
      createdOrder = await appOrdersService.placeOrder(
        bkDb,
        customer.id,
        {
          branchId: branch.id,
          type: sc.type,
          source: sc.source,
          paymentMethod: "cash",
          customerName: customer.name,
          customerPhone: customer.phone,
          items: [{ menuItemId: item.id, quantity }],
          notes: `Fresh Seeded Order — ${sc.name}`
        },
        burgerKingTenant.id,
        burgerKingTenant
      );
    } else {
      // Create via tenant orders service
      createdOrder = await tenantOrdersService.create(
        bkDb,
        {
          branchId: branch.id,
          type: sc.type,
          source: sc.source,
          paymentMethod: "cash",
          customerPhone: customer.phone,
          customerId: customer.id,
          items: [{ menuItemId: item.id, quantity, price: item.price }],
          notes: `Fresh Seeded Order — ${sc.name}`
        },
        burgerKingTenant.id
      );
    }

    // Complete order so status = COMPLETED, fee calculated & points awarded!
    const completedOrder = await tenantOrdersService.updateStatus(
      bkDb,
      createdOrder.id,
      "COMPLETED",
      burgerKingTenant.id,
      `Completed fresh order — ${sc.name}`
    );

    const calcFee = (completedOrder.total * completedOrder.feeRate) / 100;

    seededResults.push({
      scenario: sc.name,
      orderNumber: completedOrder.orderNumber,
      total: completedOrder.total,
      feeRate: completedOrder.feeRate,
      expectedFeeRate: sc.expectedFeeRate,
      calculatedFee: calcFee,
      status: completedOrder.status
    });

    console.log(`  ✅ [${sc.name}] ${completedOrder.orderNumber} | Total: SAR ${completedOrder.total} | FeeRate: ${completedOrder.feeRate}% | Fee: SAR ${calcFee.toFixed(2)}`);
  }

  // Re-fetch customer wallet
  const updatedWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customer.id } });

  console.log("\n========================================================");
  console.log("📊 FRESH SEEDING & FEE VERIFICATION SUMMARY");
  console.log("========================================================");
  console.table(seededResults);
  console.log(`\n💳 Final Customer Loyalty Points Balance: ${updatedWallet.points} pts`);
  console.log("✨ All orders successfully cleaned & seeded!");
}

executeFreshCleanupAndSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Cleanup and seed script failed:", err);
    process.exit(1);
  });
