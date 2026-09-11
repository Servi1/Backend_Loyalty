const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");
const config = require("../src/config");
const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const mainPrisma = new MainPrismaClient();

const BASE_URL = "http://localhost:5000";

async function testRealHttpOrders() {
  console.log("==================================================");
  console.log("🔍 REAL DB & HTTP ENDPOINT INSPECTION & ORDER TEST");
  console.log("==================================================");

  try {
    // 1. Inspect & Pick Real Active Tenant
    const activeTenants = await mainPrisma.tenant.findMany({
      where: { isActive: true }
    });
    console.log(`\n📋 Found ${activeTenants.length} Active Tenants in Main DB:`);
    activeTenants.forEach(t => {
      console.log(`   - [ID: ${t.id}] ${t.name} (Earn Rate: ${t.loyaltyEarnRate} pts/SAR, POS Fee: ${t.feePos}%, App Fee: ${t.feeApp}%)`);
    });

    const tenant = activeTenants[0]; // Pick primary active tenant
    if (!tenant) throw new Error("No active tenant found!");
    console.log(`\n🎯 Selected Tenant for Testing: ${tenant.name} (${tenant.id})`);

    const tenantDb = require("../src/config/tenantManager").getTenantClient(tenant.dbUrl);

    // 2. Inspect & Pick Real Customer in Main DB
    const realCustomer = await mainPrisma.appUser.findFirst({
      where: {
        phone: { not: "" },
        wallet: { isNot: null }
      },
      include: { wallet: true }
    });

    if (!realCustomer) throw new Error("No real customer with a wallet found in DB!");
    console.log(`\n👤 Selected Real Customer from DB:`);
    console.log(`   - Name : ${realCustomer.name || "N/A"}`);
    console.log(`   - Phone: ${realCustomer.phone}`);
    console.log(`   - ID   : ${realCustomer.id}`);
    console.log(`   - Wallet Points: ${realCustomer.wallet.points} pts`);

    // Generate Customer App JWT Token for authenticated app routes
    const customerToken = jwt.sign(
      { sub: realCustomer.id, role: "CUSTOMER" },
      config.jwt.secret,
      { expiresIn: "1h" }
    );

    // 3. Inspect Tenant DB Prerequisites (Branch, Menu Items, Tables, QR Cashiers, Staff)
    const branch = await tenantDb.branch.findFirst({ where: { isOpen: true } }) || await tenantDb.branch.findFirst();
    if (!branch) throw new Error(`No branch found in tenant ${tenant.name}`);
    console.log(`\n🏬 Selected Branch: ${branch.name} (${branch.id})`);

    const menuItem = await tenantDb.menuItem.findFirst({ where: { isAvailable: true } }) || await tenantDb.menuItem.findFirst();
    if (!menuItem) throw new Error(`No menuItem found in tenant ${tenant.name}`);
    console.log(`🍔 Selected Menu Item: ${menuItem.name} (${menuItem.price} SAR) [ID: ${menuItem.id}]`);

    // Table inspection / setup
    let table = tenantDb.table ? await tenantDb.table.findFirst({ where: { branchId: branch.id } }) : null;
    if (!table && tenantDb.table) {
      table = await tenantDb.table.create({
        data: { label: "Table 10", branchId: branch.id }
      });
    }
    console.log(`🪑 Table for QR_TABLE: ${table ? table.label : "None"} (ID: ${table ? table.id : "N/A"})`);

    // QR Cashier inspection / setup
    let qrCashier = tenantDb.qrCashier ? await tenantDb.qrCashier.findFirst({ where: { branchId: branch.id } }) : null;
    if (!qrCashier && tenantDb.qrCashier) {
      qrCashier = await tenantDb.qrCashier.create({
        data: { name: "Express Register", branchId: branch.id, isActive: true }
      });
    } else if (qrCashier && !qrCashier.isActive) {
      qrCashier = await tenantDb.qrCashier.update({
        where: { id: qrCashier.id },
        data: { isActive: true }
      });
    }
    console.log(`📱 QR Cashier Station: ${qrCashier ? qrCashier.name : "None"} (ID: ${qrCashier ? qrCashier.id : "N/A"}, Active: ${qrCashier ? qrCashier.isActive : false})`);

    // Cashier user inspection for POS endpoint JWT
    let cashierUser = await tenantDb.user.findFirst({
      where: { role: { in: ["CASHIER", "BRAND_MANAGER"] } }
    });
    if (!cashierUser) {
      cashierUser = await tenantDb.user.create({
        data: {
          email: `pos_cashier_${Date.now()}@servi.app`,
          name: "POS Cashier User",
          passwordHash: "dummyhash",
          role: "CASHIER",
          branchId: branch.id
        }
      });
    } else if (!cashierUser.branchId) {
      cashierUser = await tenantDb.user.update({
        where: { id: cashierUser.id },
        data: { branchId: branch.id }
      });
    }
    const cashierToken = jwt.sign({ sub: cashierUser.id }, config.jwt.secret, { expiresIn: "1h" });
    console.log(`💳 POS Cashier User: ${cashierUser.name} (${cashierUser.role}) [ID: ${cashierUser.id}]`);

    // Helper to get fresh points
    async function getFreshPoints() {
      const u = await mainPrisma.appUser.findUnique({
        where: { id: realCustomer.id },
        include: { wallet: true }
      });
      return u.wallet.points;
    }

    // 4. Test Orders Execution Across All 4 Sources
    const sourcesToTest = [
      {
        channel: "APP (Customer Mobile App)",
        source: "app",
        price: menuItem.price || 25.00,
        endpoint: `${BASE_URL}/api/app/${tenant.id}/orders/public`,
        headers: { "Content-Type": "application/json" },
        payload: {
          branchId: branch.id,
          type: "DINE_IN",
          source: "app",
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "cash",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 25.00 }]
        }
      },
      {
        channel: "POS (POS Counter Terminal)",
        source: "pos",
        price: menuItem.price || 25.00,
        endpoint: `${BASE_URL}/api/pos/orders`,
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenant.id,
          "Authorization": `Bearer ${cashierToken}`
        },
        payload: {
          branchId: branch.id,
          type: "DINE_IN",
          source: "pos",
          total: menuItem.price || 25.00,
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "card",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 25.00 }]
        }
      },
      {
        channel: "QR_TABLE (QR Table Dining)",
        source: "qr_table",
        price: menuItem.price || 25.00,
        endpoint: `${BASE_URL}/api/app/${tenant.id}/orders/public`,
        headers: { "Content-Type": "application/json" },
        payload: {
          branchId: branch.id,
          tableId: table ? table.id : undefined,
          type: "DINE_IN",
          source: "qr_table",
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "cash",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 25.00 }]
        }
      },
      {
        channel: "QR_CASHIER (Express Pickup QR)",
        source: "qr_cashier",
        price: menuItem.price || 25.00,
        endpoint: `${BASE_URL}/api/app/${tenant.id}/orders/public`,
        headers: { "Content-Type": "application/json" },
        payload: {
          branchId: branch.id,
          qrCashierId: qrCashier ? qrCashier.id : undefined,
          type: "TAKEAWAY",
          source: "qr_cashier",
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "card",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 25.00 }]
        }
      }
    ];

    let currentBalance = await getFreshPoints();

    for (const test of sourcesToTest) {
      console.log(`\n==================================================`);
      console.log(`🚀 CALLING HTTP ENDPOINT: ${test.channel}`);
      console.log(`URL: ${test.endpoint}`);

      const response = await fetch(test.endpoint, {
        method: "POST",
        headers: test.headers,
        body: JSON.stringify(test.payload)
      });

      const rawText = await response.text();
      let resData;
      try {
        resData = JSON.parse(rawText);
      } catch (e) {
        console.error(`❌ HTTP Request Failed (${response.status}):`, rawText.substring(0, 250));
        continue;
      }

      if (!response.ok || !resData.data) {
        console.error(`❌ Order Creation Failed (${response.status}):`, resData);
        continue;
      }

      const order = resData.data;
      const orderTotal = Number(order.total);
      const expectedPts = Math.floor(orderTotal * tenant.loyaltyEarnRate);

      console.log(`  ✅ HTTP 201 Created Order: #${order.orderNumber} (ID: ${order.id})`);
      console.log(`  💰 Total Amount  : ${orderTotal.toFixed(2)} SAR`);
      console.log(`  🏷️ Channel Source : ${order.source}`);
      console.log(`  📊 Initial Status : ${order.status}`);

      // Complete the order via status update
      const tenantOrdersService = require("../src/web/tenant/orders/orders.service");
      await tenantOrdersService.updateStatus(tenantDb, order.id, "COMPLETED", tenant.id);
      console.log(`  🔄 Order Status Updated to COMPLETED`);

      const newBalance = await getFreshPoints();
      const ptsDiff = newBalance - currentBalance;

      console.log(`  ⭐ Previous Balance: ${currentBalance} pts`);
      console.log(`  ⭐ New Balance     : ${newBalance} pts`);
      console.log(`  ✨ Points Awarded  : +${ptsDiff} pts (Expected: +${expectedPts} pts)`);

      // Verify Main DB aggregated order
      const aggOrder = await mainPrisma.aggregatedOrder.findFirst({
        where: { orderId: order.id }
      });
      console.log(`  📦 Main DB Aggregated Order Synced: ${aggOrder ? "YES" : "NO"}`);
      if (aggOrder) {
        console.log(`     Fee Rate: ${aggOrder.feeRate}% | Status: ${aggOrder.status}`);
      }

      currentBalance = newBalance;
    }

    console.log(`\n==================================================`);
    console.log(`🏁 TEST COMPLETED SUCCESSFULLY FOR REAL CUSTOMER`);
    console.log(`Customer: ${realCustomer.name} (${realCustomer.phone})`);
    console.log(`Final Wallet Points: ${currentBalance} pts`);
    console.log(`==================================================`);

  } catch (err) {
    console.error("❌ Test Failed:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

testRealHttpOrders();
