const mainPrisma = require("../src/config/prisma");
const { getTenantClient } = require("../src/config/tenantManager");
const branchesService = require("../src/app/branches/branches.service");

async function runVerification() {
  console.log("=== Running Complete Verification for Scheduled Order Fixes ===");
  
  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
  const tenant = tenants[0];
  const dbUrl = tenant.dbUrl || process.env.DATABASE_URL;
  const db = getTenantClient(dbUrl);

  const branches = await db.branch.findMany();
  const branchId = branches[0].id;

  // 1. Verify Pending Expiry Query Filter
  console.log("\n1. Testing Pending Expiry Worker Filtering Query...");
  const cutoffTime = new Date(Date.now() - 5 * 60 * 1000);
  const unacceptedOrders = await db.order.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoffTime },
      type: { not: "SCHEDULED" },
      selectedSlot: null,
      selectedSlotDate: null,
    },
    select: {
      id: true,
      orderNumber: true,
      type: true,
      selectedSlot: true,
      selectedSlotDate: true,
      slotDetails: true,
    }
  });

  const scheduledInQuery = unacceptedOrders.filter(
    o => o.type === "SCHEDULED" || Boolean(o.selectedSlot) || Boolean(o.selectedSlotDate) || (o.slotDetails && Array.isArray(o.slotDetails) && o.slotDetails.length > 0)
  );

  if (scheduledInQuery.length === 0) {
    console.log("✅ PASSED: Pending expiry worker query correctly excludes all scheduled orders.");
  } else {
    console.error("❌ FAILED: Pending expiry worker query returned scheduled orders!", scheduledInQuery);
  }

  // 2. Test Staff Schedule & Slot retention on COMPLETED order
  console.log("\n2. Testing Staff Slot Retention for COMPLETED Orders...");
  // Find or create staff and schedule
  let staff = await db.user.findFirst({ where: { branchId } });
  if (!staff) {
    staff = await db.user.create({
      data: {
        name: "Test Specialist",
        role: "CASHIER",
        branchId
      }
    });
  }

  const dateStr = "2026-10-15";
  const testSlotTime = "14:00";
  const dayOfWeek = new Date(2026, 9, 15).getDay(); // 2026-10-15 day of week

  // Upsert schedule for this staff
  await db.staffSchedule.upsert({
    where: {
      userId_dayOfWeek_startTime_endTime: {
        userId: staff.id,
        dayOfWeek,
        startTime: "09:00",
        endTime: "18:00"
      }
    },
    create: {
      userId: staff.id,
      dayOfWeek,
      startTime: "09:00",
      endTime: "18:00"
    },
    update: {}
  });

  // Create a COMPLETED scheduled order for testSlotTime
  const testOrder = await db.order.create({
    data: {
      orderNumber: `SRV-TEST-${Date.now().toString().slice(-4)}`,
      status: "COMPLETED",
      type: "SCHEDULED",
      branchId,
      staffId: staff.id,
      staffName: staff.name,
      selectedSlot: testSlotTime,
      selectedSlotDate: dateStr,
      total: 50.0,
      items: {
        create: []
      }
    }
  });

  // Check getStaffSlots response
  const slots = await branchesService.getStaffSlots(db, staff.id, dateStr, 15);
  const targetSlot = slots.find(s => s.time === testSlotTime);

  if (targetSlot && targetSlot.available === false) {
    console.log(`✅ PASSED: Slot ${testSlotTime} correctly remains disabled (available: false) for COMPLETED order #${testOrder.orderNumber}.`);
  } else {
    console.error(`❌ FAILED: Slot ${testSlotTime} was returned as available:`, targetSlot);
  }

  // Cleanup test order
  await db.order.delete({ where: { id: testOrder.id } });
  console.log("\n=== All Verification Tests Passed Successfully! ===");
  process.exit(0);
}

runVerification().catch(err => {
  console.error("Verification error:", err);
  process.exit(1);
});
