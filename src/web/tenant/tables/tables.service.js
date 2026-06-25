const ApiError = require("../../../utils/ApiError");

const getExpirationDate = (cycle, currentExpiresAt) => {
  const baseDate = (currentExpiresAt && new Date(currentExpiresAt) > new Date())
    ? new Date(currentExpiresAt)
    : new Date();
  
  if (cycle === "yearly") {
    baseDate.setFullYear(baseDate.getFullYear() + 1);
  } else {
    baseDate.setDate(baseDate.getDate() + 30);
  }
  return baseDate;
};

const getAll = async (db, branchId) => {
  const where = {};
  if (branchId) {
    where.branchId = branchId;
  }

  // Auto-inactivate tables that expired > 7 days ago
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const expiredActiveTables = await db.table.findMany({
    where: {
      isActive: true,
      expiresAt: {
        lt: sevenDaysAgo
      }
    }
  });

  if (expiredActiveTables.length > 0) {
    await db.table.updateMany({
      where: {
        id: {
          in: expiredActiveTables.map(t => t.id)
        }
      },
      data: {
        isActive: false
      }
    });
  }

  return db.table.findMany({
    where,
    include: {
      branch: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data, cycle) => {
  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");

  if (branch.tablesEnabled === false) {
    throw new ApiError(400, "Table feature is deactivated for this branch");
  }

  // Auto generate unique qrCode string if not provided
  const qrCode = data.qrCode || `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const expiresAt = getExpirationDate(cycle);

  return db.table.create({
    data: {
      label: data.label,
      seats: Number(data.seats) || 4,
      isActive: data.isActive !== undefined ? data.isActive : true,
      zone: data.zone || "Main Hall",
      qrCode,
      branchId: data.branchId,
      expiresAt
    },
    include: {
      branch: true
    }
  });
};

const renew = async (db, id, cycle) => {
  const table = await db.table.findUnique({ where: { id } });
  if (!table) throw new ApiError(404, "Table not found");

  const expiresAt = getExpirationDate(cycle, table.expiresAt);

  return db.table.update({
    where: { id },
    data: {
      expiresAt,
      isActive: true
    },
    include: {
      branch: true
    }
  });
};

const update = async (db, id, data) => {
  const table = await db.table.findUnique({ where: { id } });
  if (!table) throw new ApiError(404, "Table not found");

  return db.table.update({
    where: { id },
    data,
    include: {
      branch: true
    }
  });
};

const remove = async (db, id) => {
  const table = await db.table.findUnique({ where: { id } });
  if (!table) throw new ApiError(404, "Table not found");
  return db.table.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  renew,
  update,
  remove,
};
