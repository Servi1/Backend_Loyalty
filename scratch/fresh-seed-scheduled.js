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

    // 1. Clear all existing SCHEDULED orders to start fresh
    console.log("Clearing all existing SCHEDULED orders in central & tenant DBs...");
    
    // Find all scheduled order IDs in tenant DB to delete from main db
    const tenantScheduledOrders = await db.order.findMany({
      where: { type: "SCHEDULED" }
    });
    const scheduledIds = tenantScheduledOrders.map(o => o.id);

    if (scheduledIds.length > 0) {
      // Delete from main database registries
      await mainPrisma.aggregatedOrder.deleteMany({
        where: { orderId: { in: scheduledIds } }
      });
      await mainPrisma.order.deleteMany({
        where: { id: { in: scheduledIds } }
      });
      
      // Delete from tenant DB
      await db.order.deleteMany({
        where: { id: { in: scheduledIds } }
      });
      console.log(`Successfully deleted ${scheduledIds.length} existing scheduled orders.`);
    } else {
      console.log("No existing scheduled orders found.");
    }

    // 2. Fetch branch
    const branch = await db.branch.findFirst();
    if (!branch) {
      console.error("No branch found.");
      return;
    }

    // 3. Fetch Waiters
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

    // 4. Get active menu items
    const menuItems = await db.menuItem.findMany({ take: 2 });
    if (menuItems.length < 2) {
      console.error("Please ensure at least 2 menu items are in the tenant DB.");
      return;
    }

    const item1 = menuItems[0]; // e.g. Burger
    const item2 = menuItems[1]; // e.g. Signature dish

    // Update item preparation times to ensure nice card sizes (15m and 30m)
    await db.menuItem.update({
      where: { id: item1.id },
      data: { prepTime: 15 }
    });
    await db.menuItem.update({
      where: { id: item2.id },
      data: { prepTime: 30 }
    });

    console.log(`Item 1: ${item1.name} (Prep: 15m)`);
    console.log(`Item 2: ${item2.name} (Prep: 30m)`);

    const dateToSeed = "2026-08-02"; // Sunday

    // Setup Sunday schedules (08:00 - 20:00)
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

    // 5. Seed 5 orders
    const ordersToSeed = [
      {
        orderNumber: "SRV-TEST-001",
        status: "PENDING",
        waiter: waiter1,
        slot: "09:30",
        item: item1,
        slotDetails: null
      },
      {
        orderNumber: "SRV-TEST-002",
        status: "ACCEPTED",
        waiter: waiter1,
        slot: "11:00",
        item: item2,
        slotDetails: null
      },
      {
        orderNumber: "SRV-TEST-003",
        status: "PREPARING",
        waiter: waiter2,
        slot: "12:00",
        item: item2,
        slotDetails: null
      },
      {
        orderNumber: "SRV-TEST-004",
        status: "READY",
        waiter: waiter2,
        slot: "14:30",
        item: item1,
        slotDetails: null
      },
      {
        orderNumber: "SRV-TEST-005", // Multi-item order
        status: "ACCEPTED",
        isMulti: true,
        itemsList: [
          {
            item: item1,
            waiter: waiter1,
            slot: "16:00"
          },
          {
            item: item2,
            waiter: waiter2,
            slot: "16:30"
          }
        ]
      }
    ];

    console.log("\nSeeding 5 fresh scheduled orders...");

    for (const o of ordersToSeed) {
      let createdOrder;
      let slotsData = null;

      if (o.isMulti) {
        slotsData = o.itemsList.map(il => ({
          staffId: il.waiter.id,
          staffName: il.waiter.name,
          selectedSlot: il.slot,
          selectedSlotDate: dateToSeed,
          menuItemId: il.item.id,
          quantity: 1
        }));

        const orderItems = o.itemsList.map(il => ({
          menuItemId: il.item.id,
          quantity: 1,
          price: il.item.price,
          staffId: il.waiter.id,
          staffName: il.waiter.name,
          selectedSlot: il.slot,
          selectedSlotDate: dateToSeed
        }));

        const total = o.itemsList.reduce((acc, curr) => acc + curr.item.price, 0);

        createdOrder = await db.order.create({
          data: {
            orderNumber: o.orderNumber,
            status: o.status,
            type: "SCHEDULED",
            total,
            branchId: branch.id,
            source: "app",
            slotDetails: slotsData,
            items: { create: orderItems }
          }
        });
      } else {
        slotsData = [
          {
            staffId: o.waiter.id,
            staffName: o.waiter.name,
            selectedSlot: o.slot,
            selectedSlotDate: dateToSeed,
            menuItemId: o.item.id,
            quantity: 1
          }
        ];

        createdOrder = await db.order.create({
          data: {
            orderNumber: o.orderNumber,
            status: o.status,
            type: "SCHEDULED",
            total: o.item.price,
            branchId: branch.id,
            staffId: o.waiter.id,
            staffName: o.waiter.name,
            selectedSlot: o.slot,
            selectedSlotDate: dateToSeed,
            source: "pos",
            slotDetails: slotsData,
            items: {
              create: [
                {
                  menuItemId: o.item.id,
                  quantity: 1,
                  price: o.item.price,
                  staffId: o.waiter.id,
                  staffName: o.waiter.name,
                  selectedSlot: o.slot,
                  selectedSlotDate: dateToSeed
                }
              ]
            }
          }
        });
      }

      // Sync to main
      await mainPrisma.order.create({
        data: {
          id: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          status: createdOrder.status,
          type: createdOrder.type,
          total: createdOrder.total,
          tenantId: tenant.id,
          branchId: createdOrder.branchId,
          source: createdOrder.source,
          slotDetails: slotsData,
        }
      });

      await mainPrisma.aggregatedOrder.create({
        data: {
          id: `${tenant.id}_${createdOrder.id}`,
          tenantId: tenant.id,
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          status: createdOrder.status,
          type: createdOrder.type,
          total: createdOrder.total,
          branchName: branch.name,
          customerName: o.isMulti ? "Multi-Item Guest" : `${o.waiter.name} Guest`,
          source: createdOrder.source,
          slotDetails: slotsData,
        }
      });

      if (o.isMulti) {
        console.log(`Seeded Order: ${o.orderNumber} (Multi-Item checkout)`);
      } else {
        console.log(`Seeded Order: ${o.orderNumber} for ${o.waiter.name} at ${o.slot}`);
      }
    }

    console.log("\n🎉 All 5 fresh scheduled orders seeded successfully!");

  } catch (error) {
    console.error("Fresh seeding error:", error);
  } finally {
    await mainPrisma.$disconnect();
  }
}

seed();
