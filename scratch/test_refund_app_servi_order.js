const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const ordersService = require("../src/web/tenant/orders/orders.service");

async function testRefundAppServiOrder() {
  console.log("🧪 Testing refund on App Servi Order...");

  const tenant = await mainPrisma.tenant.findFirst({ where: { slug: "burgerking" } });
  const tenantDb = getTenantClient(tenant.dbUrl);

  // Find order SRV-3F9FB1
  const order = await tenantDb.order.findFirst({
    where: { orderNumber: "SRV-3F9FB1" }
  });

  if (!order) {
    console.error("❌ Order SRV-3F9FB1 not found!");
    process.exit(1);
  }

  console.log(`📦 Found Order: ${order.orderNumber} (ID: ${order.id}) | Current Status: ${order.status} | CustomerId: ${order.customerId}`);

  // Fetch initial customer wallet
  let walletBefore = await mainPrisma.wallet.findUnique({
    where: { appUserId: order.customerId }
  });
  console.log(`💳 Wallet Points BEFORE Refund: ${walletBefore.points}`);

  // Perform Refund
  console.log(`🔄 Updating order status to REFUNDED...`);
  const refundedOrder = await ordersService.updateStatus(
    tenantDb,
    order.id,
    "REFUNDED",
    tenant.id,
    "Testing App Servi order refund points reversal"
  );
  console.log(`✅ Order status updated to: ${refundedOrder.status}`);

  // Fetch updated customer wallet
  let walletAfter = await mainPrisma.wallet.findUnique({
    where: { appUserId: order.customerId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 5 } }
  });
  console.log(`💳 Wallet Points AFTER Refund: ${walletAfter.points}`);
  console.log(`\n📜 Recent Wallet Transactions:`);
  walletAfter.transactions.forEach(t => {
    console.log(` - [${t.createdAt.toISOString()}] ${t.points > 0 ? "+" : ""}${t.points} pts | Reason: ${t.description}`);
  });

  if (walletBefore.points - walletAfter.points === Math.floor(order.total)) {
    console.log(`\n🎉 SUCCESS! Reversed ${Math.floor(order.total)} points for App Servi order refund!`);
  } else {
    console.log(`\n⚠️ Difference: Before=${walletBefore.points}, After=${walletAfter.points}`);
  }
}

testRefundAppServiOrder()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
