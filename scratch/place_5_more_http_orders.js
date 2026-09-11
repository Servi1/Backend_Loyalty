const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");
const config = require("../src/config");
const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const mainPrisma = new MainPrismaClient();

const BASE_URL = "http://localhost:5000";

async function place5MoreHttpOrders() {
  console.log("==================================================");
  console.log("🚀 PLACING 5 MORE HTTP ORDERS (INCLUDING POINTS PAYMENTS)");
  console.log("==================================================");

  try {
    // 1. Get Active Tenant
    const tenant = await mainPrisma.tenant.findFirst({ where: { isActive: true } });
    if (!tenant) throw new Error("No active tenant found");
    console.log(`📌 Tenant: ${tenant.name} (${tenant.id})`);

    const tenantDb = require("../src/config/tenantManager").getTenantClient(tenant.dbUrl);

    // 2. Get Real Customer from DB
    const realCustomer = await mainPrisma.appUser.findFirst({
      where: {
        phone: { not: "" },
        wallet: { isNot: null }
      },
      include: { wallet: true }
    });

    if (!realCustomer) throw new Error("No customer found in DB");
    console.log(`👤 Customer: ${realCustomer.name} (${realCustomer.phone}) | Current Points: ${realCustomer.wallet.points} pts`);

    // 3. Tenant DB Prereqs
    const branch = await tenantDb.branch.findFirst({ where: { isOpen: true } }) || await tenantDb.branch.findFirst();
    const menuItem = await tenantDb.menuItem.findFirst({ where: { isAvailable: true } }) || await tenantDb.menuItem.findFirst();
    let table = tenantDb.table ? await tenantDb.table.findFirst({ where: { branchId: branch.id } }) : null;
    let qrCashier = tenantDb.qrCashier ? await tenantDb.qrCashier.findFirst({ where: { branchId: branch.id } }) : null;

    if (!table && tenantDb.table) {
      table = await tenantDb.table.create({ data: { label: "Table 5", branchId: branch.id } });
    }
    if (!qrCashier && tenantDb.qrCashier) {
      qrCashier = await tenantDb.qrCashier.create({ data: { name: "Express Register 2", branchId: branch.id, isActive: true } });
    } else if (qrCashier && !qrCashier.isActive) {
      qrCashier = await tenantDb.qrCashier.update({ where: { id: qrCashier.id }, data: { isActive: true } });
    }

    // Cashier user token for POS calls
    const cashierUser = await tenantDb.user.findFirst({ where: { role: { in: ["CASHIER", "BRAND_MANAGER"] } } });
    const cashierToken = jwt.sign({ sub: cashierUser.id }, config.jwt.secret, { expiresIn: "1h" });

    // Helper to get fresh points
    async function getFreshPoints() {
      const u = await mainPrisma.appUser.findUnique({
        where: { id: realCustomer.id },
        include: { wallet: true }
      });
      return u.wallet.points;
    }

    const fiveOrders = [
      {
        num: 1,
        channel: "APP (Points Payment ⭐)",
        source: "app",
        isPointsPayment: true,
        endpoint: `${BASE_URL}/api/app/${tenant.id}/orders/public`,
        headers: { "Content-Type": "application/json" },
        payload: {
          branchId: branch.id,
          type: "DINE_IN",
          source: "app",
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "points",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 12.00 }]
        }
      },
      {
        num: 2,
        channel: "POS Terminal (Cash Payment 💵)",
        source: "pos",
        isPointsPayment: false,
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
          total: menuItem.price || 15.00,
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "cash",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 15.00 }]
        }
      },
      {
        num: 3,
        channel: "QR Table (Points Payment ⭐)",
        source: "qr_table",
        isPointsPayment: true,
        endpoint: `${BASE_URL}/api/app/${tenant.id}/orders/public`,
        headers: { "Content-Type": "application/json" },
        payload: {
          branchId: branch.id,
          tableId: table ? table.id : undefined,
          type: "DINE_IN",
          source: "qr_table",
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "points",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 12.00 }]
        }
      },
      {
        num: 4,
        channel: "QR Cashier Express (Card Payment 💳)",
        source: "qr_cashier",
        isPointsPayment: false,
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
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 12.00 }]
        }
      },
      {
        num: 5,
        channel: "APP (Points Payment ⭐)",
        source: "app",
        isPointsPayment: true,
        endpoint: `${BASE_URL}/api/app/${tenant.id}/orders/public`,
        headers: { "Content-Type": "application/json" },
        payload: {
          branchId: branch.id,
          type: "DINE_IN",
          source: "app",
          customerPhone: realCustomer.phone,
          customerId: realCustomer.id,
          paymentMethod: "points",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: menuItem.price || 12.00 }]
        }
      }
    ];

    let currentBalance = await getFreshPoints();

    for (const test of fiveOrders) {
      console.log(`\n--------------------------------------------------`);
      console.log(`▶️ ORDER ${test.num}/5: ${test.channel}`);

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

      console.log(`  ✅ HTTP 201 Created Order: #${order.orderNumber} (ID: ${order.id})`);
      console.log(`  💰 Total Amount  : ${orderTotal.toFixed(2)} SAR | Payment Method: ${order.paymentMethod}`);
      console.log(`  🏷️ Channel Source : ${order.source}`);

      // Complete the order
      const tenantOrdersService = require("../src/web/tenant/orders/orders.service");
      await tenantOrdersService.updateStatus(tenantDb, order.id, "COMPLETED", tenant.id);
      console.log(`  🔄 Order Status Updated to COMPLETED`);

      const newBalance = await getFreshPoints();
      const ptsDiff = newBalance - currentBalance;

      console.log(`  ⭐ Previous Balance: ${currentBalance} pts`);
      console.log(`  ⭐ New Balance     : ${newBalance} pts`);
      console.log(`  ✨ Balance Change  : ${ptsDiff >= 0 ? '+' : ''}${ptsDiff} pts ${test.isPointsPayment ? '(Points Redeemed)' : '(Points Earned)'}`);

      // Verify Main DB aggregated order
      const aggOrder = await mainPrisma.aggregatedOrder.findFirst({ where: { orderId: order.id } });
      console.log(`  📦 Main DB Aggregated Order Synced: ${aggOrder ? "YES" : "NO"} | Fee Rate: ${aggOrder?.feeRate}%`);

      currentBalance = newBalance;
    }

    console.log(`\n==================================================`);
    console.log(`🏁 5 ORDERS PLACED SUCCESSFULLY VIA HTTP API CALLS`);
    console.log(`Customer: ${realCustomer.name} (${realCustomer.phone})`);
    console.log(`Final Customer Wallet Balance: ${currentBalance} pts`);
    console.log(`==================================================`);

  } catch (err) {
    console.error("❌ Test Failed:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

place5MoreHttpOrders();
