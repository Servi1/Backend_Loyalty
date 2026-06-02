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
    where: { isOpen: true },
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
        select: { id: true, label: true, seats: true, zone: true, qrCode: true },
      },
    },
  });
  if (!branch) throw new ApiError(404, "Branch not found");
  return branch;
};

module.exports = { getBranches, getBranch };
