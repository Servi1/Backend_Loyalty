const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const mainPrisma = require("../src/config/prisma.js");
const { getTenantClient } = require("../src/config/tenantManager.js");

async function seed() {
  try {
    const tenant = await mainPrisma.tenant.findUnique({
      where: { slug: "burgerking" }
    });
    if (!tenant) {
      console.error("Tenant burgerking not found.");
      return;
    }

    const db = getTenantClient(tenant.dbUrl);

    // 1. Get branch
    const branch = await db.branch.findFirst();
    if (!branch) {
      console.error("No branch found.");
      return;
    }

    // 2. Fetch both Waiters
    const waiter1 = await db.user.findFirst({
      where: { role: "WAITER", name: "waiter 1 bk" }
    });
    const waiter2 = await db.user.findFirst({
      where: { role: "WAITER", name: "Test Hard Delete" }
    });

    if (!waiter1 || !waiter2) {
      console.error("Make sure both 'waiter 1 bk' and 'Test Hard Delete' exist in the burgerking tenant DB.");
      return;
    }

    console.log(`Waiter 1: ${waiter1.name} (${waiter1.id})`);
    console.log(`Waiter 2: ${waiter2.name} (${waiter2.id})`);

    // 3. Ensure Sunday schedule is set for both waiters (dayOfWeek = 0)
    const sunday = 0;
    await db.staffSchedule.deleteMany({
      where: {
        userId: { in: [waiter1.id, waiter2.id] },
        dayOfWeek: sunday
      }
    });

    await db.staffSchedule.create({
      data: { userId: waiter1.id, dayOfWeek: sunday, startTime: "08:00", endTime: "20:00" }
    });
    await db.staffSchedule.create({
      data: { userId: waiter2.id, dayOfWeek: sunday, startTime: "08:00", endTime: "20:00" }
    });
    console.log("Sunday schedules seeded successfully (08:00 - 20:00).");

    // 4. Get some active menu items
    const menuItems = await db.menuItem.findMany({ take: 2 });
    if (menuItems.length < 2) {
      console.error("Please ensure at least 2 menu items are in the tenant DB.");
      return;
    }

    const item1 = menuItems[0];
    const item2 = menuItems[1];
    console.log(`Item 1: ${item1.name} (Prep: ${item1.prepTime || 30}m)`);
    console.log(`Item 2: ${item2.name} (Prep: ${item2.prepTime || 30}m)`);

    // 5. Build multi-slot order
    const orderNumber = "SRV-MULTI-SLOT";
    const dateToSeed = "2026-08-02"; // Sunday

    // Delete existing seed order if any
    try {
      const existing = await db.order.findUnique({ where: { orderNumber } });
      if (existing) {
        await db.order.delete({ where: { id: existing.id } });
        await mainPrisma.order.delete({ where: { id: existing.id } }).catch(() => {});
        console.log("Deleted old test order.");
      }
    } catch (e) {
      console.warn("Clean-up warning:", e.message);
    }

    // Build slot details
    const slotDetails = [
      {
        staffId: waiter1.id,
        staffName: waiter1.name,
        selectedSlot: "11:00",
        selectedSlotDate: dateToSeed,
        menuItemId: item1.id,
        quantity: 1
      },
      {
        staffId: waiter2.id,
        staffName: waiter2.name,
        selectedSlot: "13:30",
        selectedSlotDate: dateToSeed,
        menuItemId: item2.id,
        quantity: 1
      }
    ];

    const orderItems = [
      {
        menuItemId: item1.id,
        quantity: 1,
        price: item1.price,
        staffId: waiter1.id,
        staffName: waiter1.name,
        selectedSlot: "11:00",
        selectedSlotDate: dateToSeed
      },
      {
        menuItemId: item2.id,
        quantity: 1,
        price: item2.price,
        staffId: waiter2.id,
        staffName: waiter2.name,
        selectedSlot: "13:30",
        selectedSlotDate: dateToSeed
      }
    ];

    const finalTotal = item1.price + item2.price;

    const newOrder = await db.order.create({
      data: {
        orderNumber,
        status: "ACCEPTED",
        type: "SCHEDULED",
        total: finalTotal,
        branchId: branch.id,
        source: "app",
        slotDetails: slotDetails,
        items: {
          create: orderItems
        }
      },
      include: {
        items: { include: { menuItem: true } }
      }
    });

    // 6. Sync to main registry
    await mainPrisma.order.create({
      data: {
        id: newOrder.id,
        orderNumber: newOrder.orderNumber,
        status: newOrder.status,
        type: newOrder.type,
        total: newOrder.total,
        tenantId: tenant.id,
        branchId: newOrder.branchId,
        source: newOrder.source,
        slotDetails: slotDetails,
      }
    });

    await mainPrisma.aggregatedOrder.create({
      data: {
        id: `${tenant.id}_${newOrder.id}`,
        tenantId: tenant.id,
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        status: newOrder.status,
        type: newOrder.type,
        total: newOrder.total,
        branchName: branch.name,
        customerName: "Multi Slot Test Client",
        source: newOrder.source,
        slotDetails: slotDetails,
      }
    });

    console.log(`\n🎉 Multi-slot order ${orderNumber} seeded successfully!`);
    console.log(`- Item 1 assigned to: ${waiter1.name} on ${dateToSeed} @ 11:00`);
    console.log(`- Item 2 assigned to: ${waiter2.name} on ${dateToSeed} @ 13:30`);

  } catch (error) {
    console.error("Seeding error:", error);
  } finally {
    await mainPrisma.$disconnect();
  }
}

seed();
