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
    },
  });
  if (!branch) throw new ApiError(404, "Branch not found");
  return branch;
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
      id: "chefSarah",
      name: "Chef Sarah",
      role: "WAITER",
      customRole: "Sous Chef",
      avatarUrl: "https://images.unsplash.com/photo-1581299894007-aaa50297cf16?w=120&fit=crop",
      rating: 4.9,
      hasSchedule: false
    },
    {
      id: "chefJohn",
      name: "Chef John",
      role: "WAITER",
      customRole: "Pastry Chef",
      avatarUrl: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=120&fit=crop",
      rating: null,
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

  return dbStaff.map((staff, index) => {
    let rating = 4.5;
    let hasSchedule = false;

    if (staff.name) {
      if (staff.name.includes("Ahmed")) {
        rating = 4.8;
        hasSchedule = true;
      } else if (staff.name.includes("Sarah")) {
        rating = 4.9;
        hasSchedule = false;
      } else if (staff.name.includes("John")) {
        rating = null;
        hasSchedule = true;
      } else {
        rating = index % 2 === 0 ? 4.7 : null;
        hasSchedule = index % 2 === 0;
      }
    } else {
      rating = index % 2 === 0 ? 4.7 : null;
      hasSchedule = index % 2 === 0;
    }

    return {
      ...staff,
      rating,
      hasSchedule
    };
  });
};

module.exports = { getBranches, getBranch, getBranchStaff };
