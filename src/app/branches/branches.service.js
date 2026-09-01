/**
 * App Branches Service
 *
 * getBranches  — list all open branches with optional distance sort
 * getBranch    — single branch detail with tables
 */

const ApiError = require("../../utils/ApiError");

// Helper functions to parse and calculate dynamic isOpen and hours status
const parseTimeToMinutes = (tStr) => {
  if (!tStr) return 0;
  const parts = tStr.trim().split(" ");
  let [h, m] = parts[0].split(":").map(Number);
  if (isNaN(h)) h = 0;
  if (isNaN(m)) m = 0;
  if (parts[1]) {
    const period = parts[1].toUpperCase();
    if (period === "PM" && h < 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
  }
  return h * 60 + m;
};

const checkIsOpen = (branch) => {
  if (branch.isOpen === false) return false;
  if (!branch.openingTime || !branch.closingTime) return true;

  const openMin = parseTimeToMinutes(branch.openingTime);
  const closeMin = parseTimeToMinutes(branch.closingTime);

  if (openMin === closeMin) return true;

  const now = new Date();
  const saudiTimeStr = now.toLocaleTimeString("en-US", { timeZone: branch.timezone || "Asia/Riyadh", hour12: false });
  const [hStr, mStr] = saudiTimeStr.split(":");
  const nowMin = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

  if (openMin < closeMin) {
    return nowMin >= openMin && nowMin < closeMin;
  } else {
    return nowMin >= openMin || nowMin < closeMin;
  }
};

const formatBranchHours = (branch) => {
  if (branch.openingTime && branch.closingTime) {
    return `${branch.openingTime} - ${branch.closingTime}`;
  }
  return branch.hours || "08:00 AM - 11:00 PM";
};

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
      openingTime: true,
      closingTime: true,
      timezone: true,
      rating: true,
      ratingCount: true,
      imageUrl: true,
      menuBannerUrl: true,
      tablesEnabled: true,
      qrEnabled: true,
      customOrderTypes: {
        where: { isActive: true },
        select: { id: true, name: true, description: true },
      },
    },
  });

  return branches.map(b => ({
    ...b,
    isOpen: checkIsOpen(b),
    hours: formatBranchHours(b),
  }));
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
        select: { id: true, name: true, description: true },
      },
      qrCashiers: {
        select: { id: true, name: true, isActive: true },
      },
    },
  });
  if (!branch) throw new ApiError(404, "Branch not found");
  
  return {
    ...branch,
    isOpen: checkIsOpen(branch),
    hours: formatBranchHours(branch),
  };
};

// ─── getBranchScheduleSlots ────────────────────────────────────────────────────

const getBranchScheduleSlots = async (db, branchId, dateStr, durationMin = 60) => {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { hours: true, openingTime: true, closingTime: true }
  });

  // Try to parse business hours
  let startHour = 9;
  let startMinute = 0;
  let endHour = 21;
  let endMinute = 0;

  if (branch?.openingTime && branch?.closingTime) {
    const parseTime = (tStr) => {
      const parts = tStr.trim().split(" ");
      let [h, m] = parts[0].split(":").map(Number);
      if (isNaN(h)) h = 0;
      if (isNaN(m)) m = 0;
      if (parts[1]) {
        const period = parts[1].toUpperCase();
        if (period === "PM" && h < 12) h += 12;
        if (period === "AM" && h === 12) h = 0;
      }
      return { hour: h, minute: m };
    };

    const start = parseTime(branch.openingTime);
    const end = parseTime(branch.closingTime);
    startHour = start.hour;
    startMinute = start.minute;
    endHour = end.hour;
    endMinute = end.minute;
  } else if (branch?.hours) {
    const match = branch.hours.match(/(\d+)(?::(\d+))?\s*(am|pm)?\s*-\s*(\d+)(?::(\d+))?\s*(am|pm)?/i);
    if (match) {
      let sh = parseInt(match[1]);
      let sm = match[2] ? parseInt(match[2]) : 0;
      let eh = parseInt(match[4]);
      let em = match[5] ? parseInt(match[5]) : 0;
      const samSuffix = (match[3] || "").toLowerCase();
      const eamSuffix = (match[6] || "").toLowerCase();
      if (samSuffix === "pm" && sh !== 12) sh += 12;
      if (samSuffix === "am" && sh === 12) sh = 0;
      if (eamSuffix === "pm" && eh !== 12) eh += 12;
      if (eamSuffix === "am" && eh === 12) eh = 0;
      startHour = sh;
      startMinute = sm;
      endHour = eh;
      endMinute = em;
    }
  }

  // Generate time slot strings every durationMin minutes
  const slots = [];
  const startTotalMin = startHour * 60 + startMinute;
  let endTotalMin = endHour * 60 + endMinute;
  if (endTotalMin < startTotalMin) {
    // handles overnight branches if any (e.g. 10pm to 2am)
    endTotalMin += 24 * 60;
  }
  const totalMinutesDiff = endTotalMin - startTotalMin;

  for (let offset = 0; offset < totalMinutesDiff; offset += durationMin) {
    const totalMin = startTotalMin + offset;
    const h = Math.floor((totalMin % (24 * 60)) / 60);
    const m = totalMin % 60;
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
  const dbStaff = await db.user.findMany({
    where: {
      branchId,
      isActive: true,
      role: { in: ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"] }
    },
    select: {
      id: true,
      name: true,
      role: true,
      customRole: true,
      avatarUrl: true,
      schedules: {
        select: {
          dayOfWeek: true,
          startTime: true,
          endTime: true
        }
      }
    }
  });

  if (dbStaff.length === 0) {
    return [];
  }

  // Check which staff have actual schedule entries in the staffSchedule table
  const scheduleEntries = await db.staffSchedule.findMany({
    where: { userId: { in: dbStaff.map(s => s.id) } },
    select: { userId: true }
  });
  const scheduledStaffIds = new Set(scheduleEntries.map(e => e.userId));

  return dbStaff
    .filter(staff => scheduledStaffIds.has(staff.id))
    .map(staff => ({
      ...staff,
      hasSchedule: true,
      rating: staff.rating !== null && staff.rating !== undefined ? staff.rating : 5.0
    }));
};

const getStaffSlots = async (db, staffId, dateStr, durationStr) => {
  const duration = parseInt(durationStr, 10) || 15;

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
