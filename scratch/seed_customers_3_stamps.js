require("dotenv").config();
const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");

async function seedCustomers() {
  const tenantId = "c7e0b73c-4ba4-4c67-95d8-b03a1a84182d";
  const branchId = "167b4766-7e58-4cea-99a9-a1c75999b16e";
  const tenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
  const tenantDb = getTenantClient(tenant.dbUrl);

  const customers = [
    { id: "41067c87-f987-40be-a9ab-584661608ce8", name: "Test3", phone: "+966598775463" },
    { id: "66753d3f-8e7d-4ccc-b0f2-bb36a1c3330f", name: "Faris", phone: "+966587696323" }
  ];

  const items = [
    { id: "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7", name: "Donut", price: 20.00 },
    { id: "39626ab9-2da2-4728-a367-d4abf37dc53c", name: "Burger", price: 30.00 },
    { id: "a6a8d2d7-7c5c-4f4a-91d2-2b4f3da559f7", name: "Donut", price: 20.00 }
  ];

  for (const cust of customers) {
    console.log(`\n--- Seeding 3 Qualifying Orders for ${cust.name} (${cust.phone}) ---`);

    // Ensure wallet exists
    let wallet = await mainPrisma.wallet.findFirst({
      where: { appUserId: cust.id, tenantId }
    });
    if (!wallet) {
      wallet = await mainPrisma.wallet.create({
        data: {
          appUserId: cust.id,
          tenantId,
          points: 0,
          stamps: 0,
          lifetimeEarn: 0,
          tier: "bronze"
        }
      });
    }

    // Create 3 orders with qualifying items
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const orderNumber = "#" + Math.floor(1000 + Math.random() * 9000);

      const order = await tenantDb.order.create({
        data: {
          orderNumber,
          status: "COMPLETED",
          type: "TAKEAWAY",
          total: it.price,
          notes: `Qualifying stamp purchase #${i + 1}: ${it.name}`,
          branchId,
          customerId: cust.id,
          paymentMethod: "cash",
          source: "pos",
          items: {
            create: [
              {
                menuItemId: it.id,
                quantity: 1,
                price: it.price
              }
            ]
          }
        }
      });

      // Mirror in main DB order table
      await mainPrisma.order.create({
        data: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: "COMPLETED",
          type: "TAKEAWAY",
          total: it.price,
          branchId,
          tenantId,
          appUserId: cust.id,
          source: "pos"
        }
      });

      console.log(`  Order ${i + 1}/3 created: ${order.orderNumber} for ${it.name}`);
    }

    // Set wallet stamps to exactly 3 (3/3)
    const updated = await mainPrisma.wallet.update({
      where: { id: wallet.id },
      data: {
        stamps: 3,
        points: 70
      }
    });

    console.log(`  Wallet updated: stamps = ${updated.stamps}/3, points = ${updated.points}`);
  }

  console.log("\nALL SEEDING COMPLETED SUCCESSFULLY!");
}

seedCustomers().then(() => process.exit(0)).catch(err => { console.error("Error:", err); process.exit(1); });
