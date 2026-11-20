const ApiError = require("../../../utils/ApiError");
const bcrypt = require("bcryptjs");

const getAllStaff = async (db, branchId, startDate, endDate, shouldIncludeBrandManager = false) => {
  const allowedRoles = ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM", "WAREHOUSE_MANAGER"];
  if (shouldIncludeBrandManager) {
    allowedRoles.push("BRAND_MANAGER");
  }
  const where = {
    role: {
      in: allowedRoles
    },
    OR: [
      { customRole: null },
      { customRole: { not: "DELETED" } }
    ]
  };
  if (branchId) {
    if (typeof branchId === "string" && branchId.includes(",")) {
      where.branchId = { in: branchId.split(",").map(b => b.trim()) };
    } else if (Array.isArray(branchId)) {
      where.branchId = { in: branchId };
    } else {
      where.branchId = branchId;
    }
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  const users = await db.user.findMany({
    where,
    include: {
      branch: true,
      warehouse: true,
      schedules: true,
      specialties: true,
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return users.map(u => {
    const { password, ...safeUser } = u;
    return safeUser;
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

  const specialtiesConnect = data.specialtyIds ? data.specialtyIds.map(id => ({ id })) : [];
  const schedulesCreate = data.schedules ? data.schedules.map(s => ({
    dayOfWeek: Number(s.dayOfWeek),
    startTime: s.startTime,
    endTime: s.endTime,
    breakStartTime: s.breakStartTime || null,
    breakEndTime: s.breakEndTime || null,
    bufferTime: s.bufferTime !== undefined ? (Number(s.bufferTime) || 0) : 0
  })) : [];

  const created = await db.user.create({
    data: {
      email: data.email,
      name: data.name,
      nameAr: data.nameAr || null,
      designationAr: data.designationAr || null,
      role: data.role,
      customRole: data.customRole || null,
      avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : null,
      branchId: data.branchId || null,
      warehouseId: data.warehouseId || null,
      password: hashedPassword,
      pinCode,
      bufferTime: data.bufferTime !== undefined ? (Number(data.bufferTime) || 0) : 0,
      isActive: data.isActive !== undefined ? data.isActive : true,
      specialties: {
        connect: specialtiesConnect
      },
      schedules: {
        create: schedulesCreate
      }
    },
    include: {
      branch: true,
      warehouse: true,
      schedules: true,
      specialties: true
    }
  });

  const { password: _p, ...safeCreated } = created;
  return safeCreated;
};

const removeStaff = async (db, id, currentUser) => {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  if (user.role === "BRAND_MANAGER") {
    throw new ApiError(403, "Brand Admin cannot be deleted");
  }

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
        warehouseId: null,
        role: "CUSTOM",
        customRole: "DELETED"
      }
    });
  } else {
    // Safe to hard delete
    return db.user.delete({ where: { id } });
  }
};

const updateStaff = async (db, id, data, currentUser) => {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");

  const isTargetBrandAdmin = user.role === "BRAND_MANAGER";
  const isActorSuperAdmin = currentUser?.role?.toLowerCase() === "super_admin" || currentUser?.role === "SUPER_ADMIN" || !!currentUser?.admin;

  if (isTargetBrandAdmin && (data.email !== undefined || data.password)) {
    if (!isActorSuperAdmin) {
      throw new ApiError(403, "Only Super Admin can update Brand Admin email or password");
    }
  }

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

  // Validate if schedules, break times, or buffer time are changing while active scheduled orders exist
  if (data.schedules !== undefined || (data.bufferTime !== undefined && Number(data.bufferTime) !== Number(user.bufferTime || 0))) {
    const activeScheduledOrder = await db.order.findFirst({
      where: {
        staffId: id,
        status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] },
        selectedSlot: { not: null }
      }
    });

    if (activeScheduledOrder) {
      const currentSchedules = await db.staffSchedule.findMany({ where: { userId: id } });
      const currentBuffer = Number(user.bufferTime) || 0;
      const newBuffer = data.bufferTime !== undefined ? (Number(data.bufferTime) || 0) : currentBuffer;

      let scheduleChanged = newBuffer !== currentBuffer;
      if (!scheduleChanged && data.schedules !== undefined) {
        if (data.schedules.length !== currentSchedules.length) {
          scheduleChanged = true;
        } else {
          for (const ns of data.schedules) {
            const cs = currentSchedules.find(s => Number(s.dayOfWeek) === Number(ns.dayOfWeek));
            if (!cs) {
              scheduleChanged = true;
              break;
            }
            if (
              cs.startTime !== ns.startTime ||
              cs.endTime !== ns.endTime ||
              (cs.breakStartTime || null) !== (ns.breakStartTime || null) ||
              (cs.breakEndTime || null) !== (ns.breakEndTime || null) ||
              (Number(cs.bufferTime) || 0) !== (Number(ns.bufferTime) || 0)
            ) {
              scheduleChanged = true;
              break;
            }
          }
        }
      }

      if (scheduleChanged) {
        throw new ApiError(400, "Cancel the existing order before saving.");
      }
    }
  }

  // Handle schedules replacement
  if (data.schedules !== undefined) {
    await db.staffSchedule.deleteMany({ where: { userId: id } });
  }

  const updateData = {
    name: data.name !== undefined ? data.name : user.name,
    nameAr: data.nameAr !== undefined ? data.nameAr : user.nameAr,
    designationAr: data.designationAr !== undefined ? data.designationAr : user.designationAr,
    role: data.role !== undefined ? data.role : user.role,
    customRole: data.customRole !== undefined ? data.customRole : user.customRole,
    avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : user.avatarUrl,
    branchId: data.branchId !== undefined ? data.branchId : user.branchId,
    warehouseId: data.warehouseId !== undefined ? data.warehouseId : user.warehouseId,
    pinCode: data.pinCode || user.pinCode,
    bufferTime: data.bufferTime !== undefined ? (Number(data.bufferTime) || 0) : user.bufferTime,
    isActive: data.isActive !== undefined ? data.isActive : user.isActive,
  };

  if (data.email !== undefined) {
    updateData.email = data.email;
  }

  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }

  if (data.schedules !== undefined) {
    updateData.schedules = {
      create: data.schedules.map(s => ({
        dayOfWeek: Number(s.dayOfWeek),
        startTime: s.startTime,
        endTime: s.endTime,
        breakStartTime: s.breakStartTime || null,
        breakEndTime: s.breakEndTime || null,
        bufferTime: s.bufferTime !== undefined ? (Number(s.bufferTime) || 0) : 0
      }))
    };
  }

  if (data.specialtyIds !== undefined) {
    updateData.specialties = {
      set: data.specialtyIds.map(id => ({ id }))
    };
  }

  const updated = await db.user.update({
    where: { id },
    data: updateData,
    include: {
      branch: true,
      warehouse: true,
      schedules: true,
      specialties: true
    }
  });

  const { password: _p, ...safeUpdated } = updated;
  return safeUpdated;
};

module.exports = {
  getAllStaff,
  createStaff,
  removeStaff,
  updateStaff,
};
