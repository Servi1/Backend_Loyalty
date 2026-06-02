const ApiError = require("../../../utils/ApiError");

const getAll = async (db, branchId) => {
  const where = {};
  if (branchId) {
    where.branchId = branchId;
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

const create = async (db, data) => {
  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");

  // Auto generate unique qrCode string if not provided
  const qrCode = data.qrCode || `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return db.table.create({
    data: {
      label: data.label,
      seats: Number(data.seats) || 4,
      isActive: data.isActive !== undefined ? data.isActive : true,
      zone: data.zone || "Main Hall",
      qrCode,
      branchId: data.branchId
    },
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
  remove,
};
