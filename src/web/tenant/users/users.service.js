const ApiError = require("../../../utils/ApiError");
const bcrypt = require("bcryptjs");

const getAllStaff = async (db, branchId, startDate, endDate) => {
  const where = {
    role: {
      in: ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"]
    },
    NOT: {
      customRole: "DELETED"
    }
  };
  if (branchId) {
    where.branchId = branchId;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  return db.user.findMany({
    where,
    include: {
      branch: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const createStaff = async (db, data) => {
  // Check if email already exists
  if (data.email) {
    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ApiError(400, "Email already registered for this brand");
  }

  // Check Cashier limit vs POS Devices count for this branch
  if (data.role === "CASHIER" && data.branchId) {
    const posCount = await db.posDevice.count({
      where: { branchId: data.branchId }
    });
    const cashierCount = await db.user.count({
      where: { branchId: data.branchId, role: "CASHIER" }
    });
    if (cashierCount >= posCount) {
      throw new ApiError(400, `Cannot add Cashier. This branch has reached the limit of cashiers based on the number of POS machines (${posCount}).`);
    }
  }

  // Hash password if provided
  let hashedPassword = null;
  if (data.password) {
    hashedPassword = await bcrypt.hash(data.password, 10);
  }

  // Generate a random 4-digit pinCode if not provided (for POS roles)
  const pinCode = data.pinCode || Math.floor(1000 + Math.random() * 9000).toString();

  return db.user.create({
    data: {
      email: data.email,
      name: data.name,
      role: data.role,
      customRole: data.customRole || null,
      branchId: data.branchId || null,
      password: hashedPassword,
      pinCode,
    },
    include: {
      branch: true
    }
  });
};

const removeStaff = async (db, id) => {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  // Check if the user is referenced by any orders or cash drawer sessions
  const hasOrders = await db.order.count({ where: { userId: id } }) > 0;
  
  let hasOpenedSessions = false;
  let hasClosedSessions = false;
  try {
    const openedResult = await db.$queryRaw`SELECT COUNT(*)::int as count FROM "CashDrawerSession" WHERE "openedById" = ${id}`;
    hasOpenedSessions = (openedResult[0]?.count || 0) > 0;
  } catch (e) {
    // Table might not exist in this database version
  }

  try {
    const closedResult = await db.$queryRaw`SELECT COUNT(*)::int as count FROM "CashDrawerSession" WHERE "closedById" = ${id}`;
    hasClosedSessions = (closedResult[0]?.count || 0) > 0;
  } catch (e) {
    // Table might not exist in this database version
  }

  if (hasOrders || hasOpenedSessions || hasClosedSessions) {
    // Soft delete: nullify login identifiers, disconnect from branch to correct active staff counts, and hide user from lists
    return db.user.update({
      where: { id },
      data: {
        email: null,
        phone: null,
        pinCode: null,
        password: null,
        branchId: null,
        role: "CUSTOM",
        customRole: "DELETED"
      }
    });
  } else {
    // Safe to hard delete
    return db.user.delete({ where: { id } });
  }
};

const updateStaff = async (db, id, data) => {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  if (data.email && data.email !== user.email) {
    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ApiError(400, "Email already registered for this brand");
  }

  const targetRole = data.role || user.role;
  const targetBranchId = data.branchId !== undefined ? data.branchId : user.branchId;

  if (targetRole === "CASHIER" && targetBranchId) {
    const isSameBranchCashier = user.role === "CASHIER" && user.branchId === targetBranchId;
    if (!isSameBranchCashier) {
      const posCount = await db.posDevice.count({
        where: { branchId: targetBranchId }
      });
      const cashierCount = await db.user.count({
        where: { branchId: targetBranchId, role: "CASHIER" }
      });
      if (cashierCount >= posCount) {
        throw new ApiError(400, `Cannot update staff. This branch has reached the limit of cashiers based on the number of POS machines (${posCount}).`);
      }
    }
  }

  const updateData = {
    name: data.name,
    role: data.role,
    customRole: data.customRole || null,
    branchId: data.branchId || null,
    pinCode: data.pinCode || user.pinCode,
  };

  if (data.email !== undefined) {
    updateData.email = data.email;
  }

  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }

  return db.user.update({
    where: { id },
    data: updateData,
    include: {
      branch: true
    }
  });
};

module.exports = {
  getAllStaff,
  createStaff,
  removeStaff,
  updateStaff,
};
