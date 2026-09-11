const jwt = require("jsonwebtoken");
const config = require("../src/config");
const mainPrisma = require("../src/config/prisma");

async function seedOrdersViaApi() {
  const baseUrl = "http://localhost:5000";
  const tenantId = "9dec1f2e-480e-47f2-ab74-f0cbd7d61eb9"; // Burger King
  const branchId = "f687656d-4982-48bc-a118-10b4808b60cf"; // Burger King Main Branch
  const menuItemId = "a201d71a-f901-4f41-9973-dbfc7de195bd"; // Burger (10 SAR)
  const waiterId = "aacad4e6-d4b8-495d-b968-102831459d84"; // waiter 1 bk
  const cashierUserId = "bd1f0c7b-4d5f-4868-bb4a-ae3de305d477"; // jane (Cashier)

  const customerName = "Mansoor Ali";
  const customerPhone = "+97145443567";

  // Sign JWT token for POS / Staff authentication
  const staffToken = jwt.sign({ sub: cashierUserId }, config.jwt.secret, { expiresIn: "1h" });

  console.log("==================================================================");
  console.log("🚀 PLACING ORDERS VIA HTTP API ENDPOINTS (NO MANUAL POINTS ADDITION)");
  console.log("==================================================================\n");
  console.log(`• Customer: ${customerName} (${customerPhone})`);
  console.log(`• Tenant: Burger King (Earn Rate: 2 PTS / SAR)\n`);

  // Check initial wallet points before API calls
  let appUser = await mainPrisma.appUser.findUnique({ where: { phone: customerPhone } });
  let initialWallet = appUser ? await mainPrisma.wallet.findUnique({ where: { appUserId: appUser.id } }) : null;
  const startPoints = initialWallet ? initialWallet.points : 0;
  console.log(`• Initial Wallet Balance: ${startPoints} PTS\n`);

  const ordersToPlace = [
    {
      label: "Order 1 (App Dine-In — 15 SAR)",
      source: "app",
      url: `${baseUrl}/api/app/${tenantId}/orders/public`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        branchId,
        type: "DINE_IN",
        source: "app",
        customerPhone,
        customerName,
        items: [{ menuItemId, quantity: 1.5 }], // 15 SAR total
        paymentMethod: "cash"
      }
    },
    {
      label: "Order 2 (POS Waiter Order — 25 SAR)",
      source: "pos",
      url: `${baseUrl}/api/pos/orders`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": tenantId,
        "Authorization": `Bearer ${staffToken}`
      },
      body: {
        branchId,
        userId: waiterId,
        type: "DINE_IN",
        source: "pos",
        total: 25,
        customerPhone,
        customerName,
        items: [{ menuItemId, quantity: 2.5, price: 10 }], // 25 SAR total
        paymentMethod: "cash"
      }
    }
  ];

  for (const orderReq of ordersToPlace) {
    console.log(`📡 Placing ${orderReq.label}...`);
    const res = await fetch(orderReq.url, {
      method: orderReq.method,
      headers: orderReq.headers,
      body: JSON.stringify(orderReq.body)
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`  ❌ HTTP Error ${res.status}:`, JSON.stringify(data));
      continue;
    }

    const orderObj = data.data || data;
    console.log(`  ✅ Placed! Order Number: ${orderObj.orderNumber} | Total: ${orderObj.total} SAR`);

    // Complete order strictly via HTTP API status update endpoint
    if (orderReq.source === "pos") {
      console.log(`  🔄 Completing POS order #${orderObj.orderNumber} via HTTP API status endpoint...`);
      await fetch(`${baseUrl}/api/pos/orders/${orderObj.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "Authorization": `Bearer ${staffToken}`
        },
        body: JSON.stringify({ status: "COMPLETED" })
      });
    } else {
      console.log(`  🔄 Completing App order #${orderObj.orderNumber} via HTTP API status endpoint...`);
      await fetch(`${baseUrl}/api/tenant/${tenantId}/orders/${orderObj.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "Authorization": `Bearer ${staffToken}`
        },
        body: JSON.stringify({ status: "COMPLETED" })
      });
    }
  }

  console.log("\n==================================================================");
  console.log("🔍 CHECKING AUTOMATICALLY EARNED POINTS & WALLET TRANSACTIONS");
  console.log("==================================================================\n");

  appUser = await mainPrisma.appUser.findUnique({ where: { phone: customerPhone } });
  const finalWallet = appUser ? await mainPrisma.wallet.findUnique({
    where: { appUserId: appUser.id },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 5 } }
  }) : null;

  const endPoints = finalWallet ? finalWallet.points : 0;
  console.log(`• Final Wallet Balance for ${customerName}: ${endPoints} PTS`);
  console.log(`• Net Points Earned Automatically: +${endPoints - startPoints} PTS\n`);

  console.log("📜 Recent Automatic Wallet Transactions:");
  if (finalWallet && finalWallet.transactions.length > 0) {
    finalWallet.transactions.forEach((tx, idx) => {
      console.log(`  ${idx + 1}. [${tx.createdAt.toISOString().slice(0, 19)}] ${tx.description} | Points: +${tx.points}`);
    });
  }
}

seedOrdersViaApi().catch(console.error);
