/**
 * App Branches Service
 *
 * getBranches  — list all open branches with optional distance sort
 * getBranch    — single branch detail with tables
 */

const ApiError = require("../../utils/ApiError");

// ─── getBranches ──────────────────────────────────────────────────────────────

const getBranches = async (db) => {
  const branches = await db.branch.findMany({
    where: {
      ordersEnabled: true,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      phone: true,
      lat: true,
      lng: true,
      isOpen: true,
      hours: true,
      rating: true,
      imageUrl: true,
      menuBannerUrl: true,
      tablesEnabled: true,
      qrEnabled: true,
    },
  });
  return branches;
};

// ─── getBranch ────────────────────────────────────────────────────────────────

const getBranch = async (db, branchId) => {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    include: {
      tables: {
        where: { isActive: true },
        select: { id: true, label: true, seats: true, zone: true, qrCode: true, isActive: true, expiresAt: true },
      },
      customOrderTypes: {
        where: { isActive: true },
        select: { id: true, name: true },
      },
    },
  });
  if (!branch) throw new ApiError(404, "Branch not found");
  return branch;
};

// ─── getBranchScheduleSlots ────────────────────────────────────────────────────

const getBranchScheduleSlots = async (db, branchId, dateStr, durationMin = 60) => {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { hours: true }
  });

  // Try to parse branch hours string e.g. "9am - 9pm", "10am - 11pm"
  let startHour = 9;
  let endHour = 21;
  if (branch?.hours) {
    const match = branch.hours.match(/(\d+)\s*(am|pm)?\s*-\s*(\d+)\s*(am|pm)?/i);
    if (match) {
      let sh = parseInt(match[1]);
      let eh = parseInt(match[3]);
      const samSuffix = (match[2] || "").toLowerCase();
      const eamSuffix = (match[4] || "").toLowerCase();
      if (samSuffix === "pm" && sh !== 12) sh += 12;
      if (samSuffix === "am" && sh === 12) sh = 0;
      if (eamSuffix === "pm" && eh !== 12) eh += 12;
      if (eamSuffix === "am" && eh === 12) eh = 0;
      startHour = sh;
      endHour = eh;
    }
  }

  // Generate time slot strings every durationMin minutes
  const slots = [];
  const totalMinutes = (endHour - startHour) * 60;
  for (let offset = 0; offset < totalMinutes; offset += durationMin) {
    const h = startHour + Math.floor(offset / 60);
    const m = offset % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }

  // Count existing PENDING/IN_PROGRESS orders booked at each slot on this date
  const targetDate = dateStr || new Date().toISOString().split("T")[0];
  const existingOrders = await db.order.findMany({
    where: {
      branchId,
      selectedSlotDate: targetDate,
      selectedSlot: { not: null },
      status: { notIn: ["CANCELLED", "COMPLETED"] }
    },
    select: { selectedSlot: true }
  });

  const bookedCounts = {};
  for (const o of existingOrders) {
    if (o.selectedSlot) {
      bookedCounts[o.selectedSlot] = (bookedCounts[o.selectedSlot] || 0) + 1;
    }
  }

  const MAX_PER_SLOT = 3; // configurable capacity per time slot

  return {
    date: targetDate,
    slotDuration: durationMin,
    slots: slots.map(time => ({
      time,
      available: (bookedCounts[time] || 0) < MAX_PER_SLOT,
      bookedCount: bookedCounts[time] || 0
    }))
  };
};

const getBranchStaff = async (db, branchId) => {
  const mockStaffs = [
    {
      id: "chefAhmed",
      name: "Chef Ahmed",
      role: "WAITER",
      customRole: "Head Chef",
      avatarUrl: "https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=120&fit=crop",
      rating: 4.8,
      hasSchedule: true
    },
    {
      id: "chefJohn",
      name: "Chef John",
      role: "WAITER",
      customRole: "Pastry Chef",
      avatarUrl: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=120&fit=crop",
      rating: 4.7,
      hasSchedule: true
    }
  ];

  const dbStaff = await db.user.findMany({
    where: {
      branchId,
      role: { in: ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"] }
    },
    select: {
      id: true,
      name: true,
      role: true,
      customRole: true,
      avatarUrl: true
    }
  });

  if (dbStaff.length === 0) {
    return mockStaffs;
  }

  // Check which staff have actual schedule entries in the staffSchedule table
  const scheduleEntries = await db.staffSchedule.findMany({
    where: { userId: { in: dbStaff.map(s => s.id) } },
    select: { userId: true }
  });
  const scheduledStaffIds = new Set(scheduleEntries.map(e => e.userId));

  return dbStaff.map(staff => ({
    ...staff,
    hasSchedule: scheduledStaffIds.has(staff.id),
    rating: 4.5 // Default; can be extended to a real ratings model later
  }));
};

const getStaffSlots = async (db, staffId, dateStr, durationStr) => {
  const duration = parseInt(durationStr, 10) || 60;

  // Clean local day-of-week parsing (avoid UTC shift bugs)
  let dayOfWeek;
  if (dateStr) {
    const parts = dateStr.split("-").map(Number);
    if (parts.length === 3) {
      dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    } else {
      dayOfWeek = new Date(dateStr).getDay();
    }
  } else {
    dayOfWeek = new Date().getDay();
  }

  // Strictly look for staffSchedule entry for this staff member on this day of week
  const schedule = await db.staffSchedule.findFirst({
    where: { userId: staffId, dayOfWeek }
  });

  // If no schedule exists for this day of week, return 0 slots
  if (!schedule) {
    return [];
  }

  const startTimeStr = schedule.startTime;
  const endTimeStr = schedule.endTime;

  // Fetch booked orders for this staff member and date
  const targetDateStr = dateStr || new Date().toISOString().split("T")[0];
  const scheduledOrders = await db.order.findMany({
    where: {
      staffId: staffId,
      selectedSlotDate: targetDateStr,
      status: {
        notIn: ["CANCELLED", "COMPLETED"]
      }
    },
    select: {
      selectedSlot: true
    }
  });

  const bookedSlots = new Set(scheduledOrders.map(o => o.selectedSlot).filter(Boolean));

  const parseTime = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const formatTime = (min) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const start = parseTime(startTimeStr);
  const end = parseTime(endTimeStr);
  const slots = [];

  let curr = start;
  while (curr + duration <= end) {
    const slotTime = formatTime(curr);
    slots.push({
      time: slotTime,
      available: !bookedSlots.has(slotTime)
    });
    curr += duration;
  }

  return slots;
};

module.exports = { getBranches, getBranch, getBranchStaff, getStaffSlots, getBranchScheduleSlots };
