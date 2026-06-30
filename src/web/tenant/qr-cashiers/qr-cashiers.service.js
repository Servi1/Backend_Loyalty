const ApiError = require("../../../utils/ApiError");

const getAll = async (db, branchId) => {
  const where = {};
  if (branchId) {
    where.branchId = branchId;
  }

  return db.qrCashier.findMany({
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
  const qrCode = data.qrCode || `cashier_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return db.qrCashier.create({
    data: {
      name: data.name,
      isActive: data.isActive !== undefined ? data.isActive : true,
      qrCode,
      branchId: data.branchId
    },
    include: {
      branch: true
    }
  });
};

const update = async (db, id, data) => {
  const qrCashier = await db.qrCashier.findUnique({ where: { id } });
  if (!qrCashier) throw new ApiError(404, "QR Cashier not found");

  return db.qrCashier.update({
    where: { id },
    data,
    include: {
      branch: true
    }
  });
};

const remove = async (db, id) => {
  const qrCashier = await db.qrCashier.findUnique({ where: { id } });
  if (!qrCashier) throw new ApiError(404, "QR Cashier not found");
  return db.qrCashier.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove,
};
