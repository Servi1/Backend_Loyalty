const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const appOrdersService = require("../src/app/orders/orders.service");
const tenantOrdersService = require("../src/web/tenant/orders/orders.service");

async function seedMoreOrders() {
  console.log("🌱 Seeding additional orders across channels & branches...\n");

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
        { email: "faisal.test@burgerking.com" }
      ]
    }
  });

  if (!customer) {
    customer = await mainPrisma.appUser.create({
      data: {
        phone: "+966555123456",
        name: "Faisal Test Customer",
        email: "faisal.test@burgerking.com"
      }
    });
  }

  const branches = await bkDb.branch.findMany({});
  const menuItems = await bkDb.menuItem.findMany({ take: 6 });

  console.log(`📌 Found ${branches.length} branches: ${branches.map(b => b.name).join(", ")}`);
  console.log(`🍔 Menu Items: ${menuItems.map(m => m.name).join(", ")}\n`);

  const extraScenarios = [
    // Branch 1: Burger King Main Branch
    { branchIdx: 0, channel: "app", type: "DINE_IN", qty: 2 },
    { branchIdx: 0, channel: "app", type: "TAKEAWAY", qty: 3 },
    { branchIdx: 0, channel: "app", type: "DELIVERY", qty: 1 },
    { branchIdx: 0, channel: "app", type: "DELIVER_TO_CAR", qty: 2 },
    { branchIdx: 0, channel: "pos", type: "DINE_IN", qty: 3 },
    { branchIdx: 0, channel: "pos", type: "TAKEAWAY", qty: 2 },
    { branchIdx: 0, channel: "qr_table", type: "DINE_IN", qty: 2 },
    { branchIdx: 0, channel: "qr_cashier", type: "TAKEAWAY", qty: 1 },

    // Branch 2: Riyadh 2 (or second branch if available)
    { branchIdx: Math.min(1, branches.length - 1), channel: "app", type: "DINE_IN", qty: 1 },
    { branchIdx: Math.min(1, branches.length - 1), channel: "app", type: "SCHEDULED", qty: 2 },
    { branchIdx: Math.min(1, branches.length - 1), channel: "pos", type: "DINE_IN", qty: 2 },
    { branchIdx: Math.min(1, branches.length - 1), channel: "pos", type: "TAKEAWAY", qty: 1 },
    { branchIdx: Math.min(1, branches.length - 1), channel: "qr_table", type: "DINE_IN", qty: 3 },
    { branchIdx: Math.min(1, branches.length - 1), channel: "qr_cashier", type: "TAKEAWAY", qty: 2 }
  ];

  const results = [];

  for (let i = 0; i < extraScenarios.length; i++) {
    const sc = extraScenarios[i];
    const targetBranch = branches[sc.branchIdx];
    const item = menuItems[i % menuItems.length];

    let createdOrder;
    if (sc.channel === "app") {
      createdOrder = await appOrdersService.placeOrder(
        bkDb,
        customer.id,
        {
          branchId: targetBranch.id,
          type: sc.type,
          source: sc.channel,
          paymentMethod: "cash",
          customerName: customer.name,
          customerPhone: customer.phone,
          items: [{ menuItemId: item.id, quantity: sc.qty }],
          notes: `More Orders Seed — ${targetBranch.name} (${sc.channel}/${sc.type})`
        },
        burgerKingTenant.id,
        burgerKingTenant
      );
    } else {
      createdOrder = await tenantOrdersService.create(
        bkDb,
        {
          branchId: targetBranch.id,
          type: sc.type,
          source: sc.channel,
          paymentMethod: "cash",
          customerPhone: customer.phone,
          customerId: customer.id,
          items: [{ menuItemId: item.id, quantity: sc.qty, price: item.price }],
          notes: `More Orders Seed — ${targetBranch.name} (${sc.channel}/${sc.type})`
        },
        burgerKingTenant.id
      );
    }

    const completedOrder = await tenantOrdersService.updateStatus(
      bkDb,
      createdOrder.id,
      "COMPLETED",
      burgerKingTenant.id,
      `Completed order — ${sc.channel}/${sc.type}`
    );

    const calcFee = (completedOrder.total * completedOrder.feeRate) / 100;

    results.push({
      branch: targetBranch.name,
      orderNumber: completedOrder.orderNumber,
      channel: sc.channel,
      type: sc.type,
      total: completedOrder.total,
      feeRate: `${completedOrder.feeRate}%`,
      fee: parseFloat(calcFee.toFixed(2))
    });

    console.log(`  ✅ [${targetBranch.name}] ${completedOrder.orderNumber} (${sc.channel}/${sc.type}) | Total: SAR ${completedOrder.total} | Fee: SAR ${calcFee.toFixed(2)}`);
  }

  const updatedWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: customer.id } });

  console.log("\n========================================================");
  console.log("📊 ADDITIONAL SEEDED ORDERS SUMMARY");
  console.log("========================================================");
  console.table(results);
  console.log(`\n💳 Updated Loyalty Balance for ${customer.name}: ${updatedWallet.points} pts`);
  console.log("✨ Successfully seeded additional orders!");
}

seedMoreOrders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed script failed:", err);
    process.exit(1);
  });
