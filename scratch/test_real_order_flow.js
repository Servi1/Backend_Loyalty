const jwt = require("jsonwebtoken");
const config = require("../src/config");
const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function testRealFlow() {
  const baseUrl = "http://localhost:5000";
  const tenantId = "9dec1f2e-480e-47f2-ab74-f0cbd7d61eb9"; // Burger King
  const branchId = "f687656d-4982-48bc-a118-10b4808b60cf"; // Burger King Main Branch
  const menuItemId = "a201d71a-f901-4f41-9973-dbfc7de195bd"; // Burger (10 SAR)
  const customerPhone = "+96654352663"; // Sara
  const customerName = "Sara";
  const cashierUserId = "bd1f0c7b-4d5f-4868-bb4a-ae3de305d477"; // jane (Cashier)
  const waiterId = "aacad4e6-d4b8-495d-b968-102831459d84"; // waiter 1 bk
  const tableId = "e73d6cbc-3609-4ed0-8e97-4e59c2f44e11"; // Table 1
  const qrCashierId = "1d35c121-2717-4dd2-b177-0e6a6f155a20"; // Cashier 1

  // Sign JWT token for POS authentication
  const posToken = jwt.sign({ sub: cashierUserId }, config.jwt.secret, { expiresIn: "1h" });

  console.log("==================================================================");
  console.log("🚀 TESTING REAL END-TO-END HTTP API ORDER PLACEMENT FLOW");
  console.log("==================================================================\n");
  console.log(`• Brand: Burger King (${tenantId})`);
  console.log(`• Customer Profile: ${customerName} (${customerPhone})`);
  console.log(`• Menu Item: Burger (Price: 10 SAR x 2 = 20.00 SAR total per order)\n`);

  const testCases = [
    {
      channel: "App (Mobile App Servi)",
      source: "app",
      url: `${baseUrl}/api/app/${tenantId}/orders/public`,
      body: {
        branchId,
        type: "DINE_IN",
        source: "app",
        customerPhone,
        customerName,
        items: [{ menuItemId, quantity: 2 }],
        paymentMethod: "cash"
      },
      headers: { "Content-Type": "application/json" }
    },
    {
      channel: "POS (Cashier / Waiter)",
      source: "pos",
      url: `${baseUrl}/api/pos/orders`,
      body: {
        branchId,
        userId: waiterId,
        type: "DINE_IN",
        source: "pos",
        total: 20,
        customerPhone,
        customerName,
        items: [{ menuItemId, quantity: 2, price: 10 }],
        paymentMethod: "cash"
      },
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": tenantId,
        "Authorization": `Bearer ${posToken}`
      }
    },
    {
      channel: "QR Table (Dine-in)",
      source: "qr_table",
      url: `${baseUrl}/api/app/${tenantId}/orders/public`,
      body: {
        branchId,
        tableId,
        type: "DINE_IN",
        source: "qr_table",
        customerPhone,
        customerName,
        items: [{ menuItemId, quantity: 2 }],
        paymentMethod: "cash"
      },
      headers: { "Content-Type": "application/json" }
    },
    {
      channel: "QR Cashier (Takeaway)",
      source: "qr_cashier",
      url: `${baseUrl}/api/app/${tenantId}/orders/public`,
      body: {
        branchId,
        qrCashierId,
        type: "TAKEAWAY",
        source: "qr_cashier",
        customerPhone,
        customerName,
        items: [{ menuItemId, quantity: 2 }],
        paymentMethod: "cash"
      },
      headers: { "Content-Type": "application/json" }
    }
  ];

  const createdOrders = [];
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  const tenantDb = getTenantClient(tenant.dbUrl);

  for (const tc of testCases) {
    console.log(`📡 Sending HTTP POST to endpoint [Channel: ${tc.channel}]...`);
    try {
      const res = await fetch(tc.url, {
        method: "POST",
        headers: tc.headers,
        body: JSON.stringify(tc.body)
      });

      const data = await res.json();
      if (!res.ok) {
        console.error(`❌ HTTP Error ${res.status}:`, JSON.stringify(data));
        continue;
      }

      const orderData = data.data || data;
      console.log(`  ✅ Order Placed! Order #: ${orderData.orderNumber} (ID: ${orderData.id})`);

      // Update status to COMPLETED to trigger loyalty points & revenue fee calculation
      if (tc.source === "pos") {
        await fetch(`${baseUrl}/api/pos/orders/${orderData.id}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-tenant-id": tenantId,
            "Authorization": `Bearer ${posToken}`
          },
          body: JSON.stringify({ status: "COMPLETED" })
        });
      } else {
        // Complete tenant order
        await tenantDb.order.update({
          where: { id: orderData.id },
          data: { status: "COMPLETED" }
        });
        const updatedTenantOrder = await tenantDb.order.findUnique({
          where: { id: orderData.id },
          include: { items: true, branch: true }
        });
        const ordersService = require("../src/web/tenant/orders/orders.service");
        await ordersService.updateStatus(tenantDb, orderData.id, "COMPLETED", tenantId);
      }

      createdOrders.push({
        channel: tc.channel,
        orderId: orderData.id,
        orderNumber: orderData.orderNumber,
        source: tc.source
      });
    } catch (err) {
      console.error(`❌ Error placing order for ${tc.channel}:`, err.message);
    }
  }

  console.log("\n==================================================================");
  console.log("🔍 REAL-TIME SUPER ADMIN AGGREGATED ORDERS & FEES VERIFICATION");
  console.log("==================================================================\n");

  for (const o of createdOrders) {
    const agg = await mainPrisma.aggregatedOrder.findFirst({
      where: { orderId: o.orderId }
    });

    if (!agg) {
      console.error(`❌ Aggregated order record missing for ${o.orderNumber}`);
      continue;
    }

    const feePercentage = agg.feeRate || 0;
    const feeAmount = (agg.total * (feePercentage / 100)).toFixed(2);
    const expectedPoints = Math.floor(agg.total * (tenant.loyaltyEarnRate || 1));

    console.log(`📌 Channel: ${o.channel}`);
    console.log(`   • Order Number:      ${agg.orderNumber}`);
    console.log(`   • Customer Name:     ${agg.customerName}`);
    console.log(`   • Customer Phone:    ${agg.customerPhone || "N/A"}`);
    console.log(`   • Order Total:       ${agg.total.toFixed(2)} SAR`);
    console.log(`   • Channel Source:    ${agg.source}`);
    console.log(`   • Configured Fee %:  ${feePercentage}%`);
    console.log(`   • Transaction Fee:   ${feeAmount} SAR`);
    console.log(`   • Loyalty Earn Rate: ${tenant.loyaltyEarnRate} PTS / SAR`);
    console.log(`   • Loyalty Points:    +${expectedPoints} PTS`);
    console.log("------------------------------------------------------------------");
  }
}

testRealFlow().catch(console.error);
