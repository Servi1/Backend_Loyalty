const ApiError = require("../../../utils/ApiError");
const bcrypt = require("bcryptjs");

const getAllStaff = async (db, branchId, startDate, endDate) => {
  const where = {
    role: {
      in: ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN"]
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
  return db.user.delete({ where: { id } });
};

module.exports = {
  getAllStaff,
  createStaff,
  removeStaff,
};
