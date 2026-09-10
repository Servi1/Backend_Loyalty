const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function cleanupCustomer() {
  const phoneSearch = "550505994";
  console.log(`Searching for customer with phone containing: ${phoneSearch}`);

  const customers = await mainPrisma.appUser.findMany({
    where: {
      OR: [
        { phone: { contains: phoneSearch } },
        { name: { contains: "Customer Menu Test", mode: "insensitive" } }
      ]
    },
    include: { wallet: true }
  });

  console.log(`Found ${customers.length} customer(s) to clean up.`);

  const tenants = await mainPrisma.tenant.findMany();

  for (const cust of customers) {
    console.log(`Deleting data for customer ID: ${cust.id}, Name: ${cust.name}, Phone: ${cust.phone}`);

    // 1. Delete wallet transactions & wallet
    if (cust.wallet) {
      await mainPrisma.walletTransaction.deleteMany({
        where: { walletId: cust.wallet.id }
      });
      await mainPrisma.wallet.delete({
        where: { id: cust.wallet.id }
      });
      console.log(`Deleted wallet and transactions for user ${cust.id}`);
    }

    // 2. Delete main database orders
    await mainPrisma.order.deleteMany({
      where: {
        appUserId: cust.id
      }
    });

    // 3. Delete aggregated orders
    await mainPrisma.aggregatedOrder.deleteMany({
      where: {
        customerPhone: { contains: phoneSearch }
      }
    });
    console.log(`Deleted aggregated orders for phone ${phoneSearch}`);

    // 4. Delete tenant database orders & order items
    for (const t of tenants) {
      try {
        const tenantPrisma = getTenantClient(t.dbUrl);
        const tenantOrders = await tenantPrisma.order.findMany({
          where: {
            OR: [
              { customerId: cust.id },
              { userId: cust.id },
              { customerPhone: { contains: phoneSearch } }
            ]
          },
          select: { id: true }
        });

        if (tenantOrders.length > 0) {
          const orderIds = tenantOrders.map(o => o.id);
          await tenantPrisma.orderItem.deleteMany({
            where: { orderId: { in: orderIds } }
          });
          await tenantPrisma.order.deleteMany({
            where: { id: { in: orderIds } }
          });
          console.log(`Deleted ${tenantOrders.length} orders from tenant ${t.name}`);
        }
      } catch (err) {
        console.error(`Error deleting orders for tenant ${t.name}:`, err.message);
      }
    }

    // 5. Delete AppUser record
    await mainPrisma.appUser.delete({
      where: { id: cust.id }
    });
    console.log(`Deleted AppUser ${cust.id} (${cust.name}) successfully.`);
  }

  console.log("Cleanup complete!");
  process.exit(0);
}

cleanupCustomer().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
