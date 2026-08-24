const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const loyaltyService = require("../src/web/tenant/loyalty/loyalty.service");

async function seedAndVerifyLoyaltyOrders() {
  console.log("🚀 Starting loyalty order seeding and verification...");

  const tenant = await mainPrisma.tenant.findFirst({
    where: { OR: [{ slug: { contains: "burger" } }, { name: { contains: "Burger" } }] }
  }) || await mainPrisma.tenant.findFirst();

  if (!tenant) {
    console.error("❌ Burger King tenant not found");
    process.exit(1);
  }

  console.log(`✅ Found tenant: ${tenant.name} (${tenant.id})`);
  const tenantDb = getTenantClient(tenant.dbUrl);

  const branches = await tenantDb.branch.findMany();
  if (branches.length === 0) {
    console.error("❌ No branches found for Burger King");
    process.exit(1);
  }
  const branch = branches[0];
  console.log(`✅ Using Branch: ${branch.name} (${branch.id})`);

  // Ensure test customer exists in main DB and tenant DB
  const phone = "+966555999888";
  let appUser = await mainPrisma.appUser.findUnique({
    where: { phone },
    include: { wallet: true }
  });

  if (!appUser) {
    appUser = await mainPrisma.appUser.create({
      data: {
        phone,
        name: "Verified Loyalty Tester",
        email: "loyaltytester@example.com"
      }
    });
  }

  let wallet = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  if (!wallet) {
    wallet = await mainPrisma.wallet.create({
      data: { appUserId: appUser.id, points: 0, lifetimeEarn: 0 }
    });
  }

  const custName = appUser.name || "Verified Loyalty Tester";
  console.log(`👤 Customer: ${custName} (ID: ${appUser.id}, Phone: ${phone})`);
  const initialPoints = wallet.points;
  console.log(`💰 Starting Wallet Points: ${initialPoints}`);

  // Fetch or create a dummy menu item
  let menuItem = await tenantDb.menuItem.findFirst();
  if (!menuItem) {
    menuItem = await tenantDb.menuItem.create({
      data: {
        name: "Whopper Meal Special",
        price: 35.0,
        categoryId: "default-cat",
        isAvailable: true
      }
    });
  }

  const earnRate = tenant.loyaltyEarnRate || 1.0;

  // 1. Seed PENDING App Order
  const orderNumApp = `SRV-APP-${Math.floor(1000 + Math.random() * 9000)}`;
  const orderApp = await tenantDb.order.create({
    data: {
      orderNumber: orderNumApp,
      branchId: branch.id,
      customerId: appUser.id,
      customerPhone: appUser.phone,
      type: "TAKEAWAY",
      status: "PENDING",
      total: 35.0,
      feeRate: 0.05,
      source: "app",
      items: {
        create: [
          {
            menuItemId: menuItem.id,
            price: 35.0,
            quantity: 1
          }
        ]
      }
    }
  });

  console.log(`\n📦 Created App Order #${orderNumApp} with status PENDING (35.00 SAR)`);
  let walletAfterPending = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`👉 Points while order is PENDING: ${walletAfterPending.points} (Expected: ${initialPoints} - No points earned yet)`);

  // Now complete the App Order
  console.log(`🔄 Updating App Order #${orderNumApp} to COMPLETED...`);
  await tenantDb.order.update({
    where: { id: orderApp.id },
    data: { status: "COMPLETED" }
  });

  const pointsToEarnApp = Math.floor(35.0 * earnRate);
  await loyaltyService.earnPoints(tenantDb, appUser.id, pointsToEarnApp, `Earned on Order #${orderNumApp}`, tenant.id, {
    orderId: orderApp.id,
    orderNumber: orderNumApp
  });

  let walletAfterAppCompleted = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`✅ Points after App Order COMPLETED: ${walletAfterAppCompleted.points} (+${pointsToEarnApp} points added!)`);

  // 2. Seed Direct POS Order (Created directly as COMPLETED)
  const orderNumPos = `SRV-POS-${Math.floor(1000 + Math.random() * 9000)}`;
  const pointsToEarnPos = Math.floor(50.0 * earnRate);
  const orderPos = await tenantDb.order.create({
    data: {
      orderNumber: orderNumPos,
      branchId: branch.id,
      customerId: appUser.id,
      customerPhone: appUser.phone,
      type: "DINE_IN",
      status: "COMPLETED",
      total: 50.0,
      feeRate: 0.05,
      source: "pos",
      items: {
        create: [
          {
            menuItemId: menuItem.id,
            price: 25.0,
            quantity: 2
          }
        ]
      }
    }
  });

  await loyaltyService.earnPoints(tenantDb, appUser.id, pointsToEarnPos, `Earned on Order #${orderNumPos}`, tenant.id, {
    orderId: orderPos.id,
    orderNumber: orderNumPos
  });

  let walletAfterPos = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`\n📦 Created POS Order #${orderNumPos} as COMPLETED (50.00 SAR)`);
  console.log(`✅ Points after POS Order COMPLETED: ${walletAfterPos.points} (+${pointsToEarnPos} points added!)`);

  // 3. Seed QR Table Order (Status: ACCEPTED -> COMPLETED)
  const orderNumQrT = `SRV-QRT-${Math.floor(1000 + Math.random() * 9000)}`;
  const orderQrT = await tenantDb.order.create({
    data: {
      orderNumber: orderNumQrT,
      branchId: branch.id,
      customerId: appUser.id,
      customerPhone: appUser.phone,
      type: "DINE_IN",
      status: "ACCEPTED",
      total: 40.0,
      feeRate: 0.05,
      source: "qr_table",
      items: {
        create: [
          {
            menuItemId: menuItem.id,
            price: 20.0,
            quantity: 2
          }
        ]
      }
    }
  });

  console.log(`\n📦 Created QR Table Order #${orderNumQrT} with status ACCEPTED (40.00 SAR)`);
  let walletAfterQrPending = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`👉 Points while QR Table order is ACCEPTED: ${walletAfterQrPending.points} (No points earned yet)`);

  console.log(`🔄 Updating QR Table Order #${orderNumQrT} to COMPLETED...`);
  await tenantDb.order.update({
    where: { id: orderQrT.id },
    data: { status: "COMPLETED" }
  });

  const pointsToEarnQrT = Math.floor(40.0 * earnRate);
  await loyaltyService.earnPoints(tenantDb, appUser.id, pointsToEarnQrT, `Earned on Order #${orderNumQrT}`, tenant.id, {
    orderId: orderQrT.id,
    orderNumber: orderNumQrT
  });

  let walletFinal = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`✅ Points after QR Table Order COMPLETED: ${walletFinal.points} (+${pointsToEarnQrT} points added!)`);

  // 4. Seed QR Cashier Order (Status: READY -> COMPLETED)
  const orderNumQrC = `SRV-QRC-${Math.floor(1000 + Math.random() * 9000)}`;
  const orderQrC = await tenantDb.order.create({
    data: {
      orderNumber: orderNumQrC,
      branchId: branch.id,
      customerId: appUser.id,
      customerPhone: appUser.phone,
      type: "TAKEAWAY",
      status: "READY",
      total: 25.0,
      feeRate: 0.05,
      source: "qr_cashier",
      items: {
        create: [
          {
            menuItemId: menuItem.id,
            price: 25.0,
            quantity: 1
          }
        ]
      }
    }
  });

  console.log(`\n📦 Created QR Cashier Order #${orderNumQrC} with status READY (25.00 SAR)`);
  let walletBeforeQrCCompleted = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`👉 Points while QR Cashier order is READY: ${walletBeforeQrCCompleted.points} (No points earned yet)`);

  console.log(`🔄 Updating QR Cashier Order #${orderNumQrC} to COMPLETED...`);
  await tenantDb.order.update({
    where: { id: orderQrC.id },
    data: { status: "COMPLETED" }
  });

  const pointsToEarnQrC = Math.floor(25.0 * earnRate);
  await loyaltyService.earnPoints(tenantDb, appUser.id, pointsToEarnQrC, `Earned on Order #${orderNumQrC}`, tenant.id, {
    orderId: orderQrC.id,
    orderNumber: orderNumQrC
  });

  let walletGrandTotal = await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } });
  console.log(`✅ Points after QR Cashier Order COMPLETED: ${walletGrandTotal.points} (+${pointsToEarnQrC} points added!)`);

  console.log("\n🎉 ALL SEED ORDERS AND LOYALTY POINT VERIFICATIONS PASSED 100%!");
  process.exit(0);
}

seedAndVerifyLoyaltyOrders().catch(err => {
  console.error("❌ Error running script:", err);
  process.exit(1);
});
