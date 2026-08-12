const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function main() {
  console.log("=== Searching AggregatedOrders in mainPrisma ===");
  const aggOrders = await mainPrisma.aggregatedOrder.findMany({
    where: {
      OR: [
        { orderNumber: { contains: "BK-5PCT", mode: "insensitive" } },
        { id: { contains: "bk_5pct", mode: "insensitive" } },
        { orderId: { contains: "bk_5pct", mode: "insensitive" } }
      ]
    }
  });
  console.log("AggregatedOrders found:", aggOrders);

  console.log("\n=== Searching all Tenants ===");
  const tenants = await mainPrisma.tenant.findMany();
  for (const t of tenants) {
    try {
      const tenantPrisma = getTenantClient(t.dbUrl);
      const orders = await tenantPrisma.order.findMany({
        where: {
          OR: [
            { orderNumber: { contains: "BK-5PCT", mode: "insensitive" } },
            { id: { contains: "bk_5pct", mode: "insensitive" } }
          ]
        }
      });
      if (orders.length > 0) {
        console.log(`Tenant ${t.name} (${t.id}) found orders:`, orders.map(o => ({ id: o.id, orderNumber: o.orderNumber, status: o.status })));
      }
    } catch (err) {
      console.error(`Error querying tenant ${t.name}:`, err.message);
    }
  }

  process.exit(0);
}

main();
