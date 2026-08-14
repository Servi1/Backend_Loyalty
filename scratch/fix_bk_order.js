const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function main() {
  const tenant = await mainPrisma.tenant.findUnique({ where: { slug: "burgerking" } });
  const tenantPrisma = getTenantClient(tenant.dbUrl);

  const completed = await tenantPrisma.order.findUnique({
    where: { id: "bk_5pct_completed" },
    include: { items: true, branch: true }
  });
  console.log("Completed order in BK tenant DB:", completed);

  // Check if bk_5pct_pending exists or create it if missing
  let pending = await tenantPrisma.order.findUnique({
    where: { id: "bk_5pct_pending" }
  });
  console.log("Pending order before fix:", pending);

  if (!pending && completed) {
    pending = await tenantPrisma.order.create({
      data: {
        id: "bk_5pct_pending",
        orderNumber: "BK-5PCT-002",
        status: "PENDING",
        type: "DINE_IN",
        total: 200,
        feeRate: 5,
        source: "app",
        branchId: completed.branchId,
        items: {
          create: completed.items.map(item => ({
            quantity: item.quantity,
            price: item.price,
            menuItemId: item.menuItemId
          }))
        }
      }
    });
    console.log("Created bk_5pct_pending in tenant DB:", pending);
  }

  process.exit(0);
}

main();
