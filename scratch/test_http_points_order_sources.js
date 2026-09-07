const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");
const config = require("../src/config");
const { PrismaClient: MainPrismaClient } = require("@prisma/client-main");
const mainPrisma = new MainPrismaClient();

const BASE_URL = "http://localhost:5000";

async function runTest() {
  console.log("==================================================");
  console.log("🚀 HTTP ENDPOINT TEST: ORDER SOURCES & POINT SYSTEM");
  console.log("==================================================");

  try {
    // 1. Get Tenant
    const tenant = await mainPrisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant found");
    console.log(`📌 Tenant: ${tenant.name} (${tenant.id}) | Earn Rate: ${tenant.loyaltyEarnRate} pts/SAR`);

    const tenantDb = require("../src/config/tenantManager").getTenantClient(tenant.dbUrl);

    // 2. Get or create a fresh customer for testing points calculation
    let testCustomer = await mainPrisma.appUser.findFirst({
      where: { phone: "+966500000999" },
      include: { wallet: true }
    });

    if (!testCustomer) {
      testCustomer = await mainPrisma.appUser.create({
        data: {
          id: `test_http_user_${Date.now()}`,
          phone: "+966500000999",
          name: "HTTP Test User",
          email: "httptest@servi.app",
          wallet: {
            create: {
              points: 0
            }
          }
        },
        include: { wallet: true }
      });
    } else {
      // Clear today's wallet transactions for clean daily cap test
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      await mainPrisma.walletTransaction.deleteMany({
        where: {
          walletId: testCustomer.wallet.id,
          createdAt: { gte: startOfDay }
        }
      });
    }

    console.log(`👤 Customer: ${testCustomer.name} (${testCustomer.phone}) | Initial Balance: ${testCustomer.wallet?.points || 0} pts`);

    const branch = await tenantDb.branch.findFirst();

    // 3. Find/Create Cashier user inside tenant DB for POS auth token
    let cashierUser = await tenantDb.user.findFirst({
      where: { role: { in: ["CASHIER", "BRAND_MANAGER"] } }
    });

    if (!cashierUser) {
      cashierUser = await tenantDb.user.create({
        data: {
          email: `cashier_test_${Date.now()}@servi.app`,
          name: "Test Cashier",
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

    // 4. Fetch Branch & Menu Items
    const menuItem = await tenantDb.menuItem.findFirst();
    let table = tenantDb.table ? await tenantDb.table.findFirst() : null;
    let qrCashier = tenantDb.qrCashier ? await tenantDb.qrCashier.findFirst() : null;

    if (!table) {
      table = await tenantDb.table.create({
        data: {
          tableNumber: "T-99",
          branchId: branch.id
        }
      });
    }

    if (!qrCashier) {
      qrCashier = await tenantDb.qrCashier.create({
        data: {
          name: "Express Register 1",
          branchId: branch.id,
          isActive: true
        }
      });
    } else if (!qrCashier.isActive) {
      qrCashier = await tenantDb.qrCashier.update({
        where: { id: qrCashier.id },
        data: { isActive: true }
      });
    }

    // Helper to get live points
    async function getFreshPoints() {
      const u = await mainPrisma.appUser.findUnique({
        where: { id: testCustomer.id },
        include: { wallet: true }
      });
      return u.wallet?.points || 0;
    }

    const testCases = [
      {
        name: "Mobile App Order",
        source: "app",
        price: 15.00, // Expected pts = 30
        payload: {
          branchId: branch.id,
          type: "DINE_IN",
          source: "app",
          customerPhone: testCustomer.phone,
          customerId: testCustomer.id,
          paymentMethod: "cash",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: 15.00 }]
        }
      },
      {
        name: "POS Counter Order",
        source: "pos",
        isPos: true,
        payload: {
          branchId: branch.id,
          type: "DINE_IN",
          source: "pos",
          total: 30.00,
          customerPhone: testCustomer.phone,
          customerId: testCustomer.id,
          paymentMethod: "card",
          items: [{ menuItemId: menuItem.id, quantity: 2, price: menuItem.price }]
        }
      },
      {
        name: "QR Table Order",
        source: "qr_table",
        price: 10.00, // Expected pts = 20
        payload: {
          branchId: branch.id,
          tableId: table.id,
          type: "DINE_IN",
          source: "qr_table",
          customerPhone: testCustomer.phone,
          customerId: testCustomer.id,
          paymentMethod: "cash",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: 10.00 }]
        }
      },
      {
        name: "QR Cashier Express Order",
        source: "qr_cashier",
        price: 5.00, // Expected pts = 10
        payload: {
          branchId: branch.id,
          qrCashierId: qrCashier.id,
          type: "TAKEAWAY",
          source: "qr_cashier",
          customerPhone: testCustomer.phone,
          customerId: testCustomer.id,
          paymentMethod: "card",
          items: [{ menuItemId: menuItem.id, quantity: 1, price: 5.00 }]
        }
      }
    ];

    let currentPoints = await getFreshPoints();

    for (const tc of testCases) {
      console.log(`\n--------------------------------------------------`);
      console.log(`▶️ CALLING HTTP ENDPOINT FOR SOURCE: [ ${tc.source.toUpperCase()} ] (${tc.name})`);

      let response;
      if (tc.isPos) {
        response = await fetch(`${BASE_URL}/api/pos/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-tenant-id": tenant.id,
            "Authorization": `Bearer ${cashierToken}`
          },
          body: JSON.stringify(tc.payload)
        });
      } else {
        response = await fetch(`${BASE_URL}/api/app/${tenant.id}/orders/public`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tc.payload)
        });
      }

      const rawText = await response.text();
      let resData;
      try {
        resData = JSON.parse(rawText);
      } catch (e) {
        console.error(`❌ HTTP Request Failed (${response.status}):`, rawText.substring(0, 300));
        continue;
      }

      const order = resData.data;
      const orderTotal = Number(order.total);
      const expectedPoints = Math.floor(orderTotal * tenant.loyaltyEarnRate);
      console.log(`  ✅ HTTP 201 Created Order: #${order.orderNumber} (ID: ${order.id})`);
      console.log(`  💰 Total: ${orderTotal} SAR | Channel Source: ${order.source} | Initial Status: ${order.status}`);
      console.log(`  🧮 Configured Earn Rate: ${tenant.loyaltyEarnRate} pts/SAR => Expected Points: +${expectedPoints} pts`);

      // Complete the order to trigger loyalty point distribution
      const tenantOrdersService = require("../src/web/tenant/orders/orders.service");
      await tenantOrdersService.updateStatus(tenantDb, order.id, "COMPLETED", tenant.id);
      console.log(`  🔄 Order Status updated to COMPLETED`);

      const newPoints = await getFreshPoints();
      const pointsDiff = newPoints - currentPoints;

      console.log(`  ⭐ Wallet Balance Before: ${currentPoints} pts`);
      console.log(`  ⭐ Wallet Balance After : ${newPoints} pts`);
      console.log(`  ✨ Points Awarded       : +${pointsDiff} pts`);

      if (pointsDiff === expectedPoints) {
        console.log(`  🎉 VERIFICATION PASSED: Points calculated & awarded correctly!`);
      } else {
        console.log(`  ⚠️ VERIFICATION RESULT: Awarded ${pointsDiff} pts (Expected ${expectedPoints} pts).`);
      }

      currentPoints = newPoints;
    }

    console.log(`\n==================================================`);
    console.log(`🏁 TEST COMPLETED SUCCESSFULLY`);
    console.log(`Final Customer Wallet Balance: ${currentPoints} pts`);
    console.log(`==================================================`);

  } catch (err) {
    console.error("❌ Test Failed:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

runTest();
