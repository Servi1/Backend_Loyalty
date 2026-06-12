const ApiError = require("../../../utils/ApiError");

const getAll = async (db, branchId) => {
  const where = {};
  if (branchId && branchId !== "all") {
    where.branchId = branchId;
  }
  return db.posDevice.findMany({
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

  // Generate unique 8-digit random number
  let deviceKey = "";
  let isUnique = false;
  while (!isUnique) {
    deviceKey = Math.floor(10000000 + Math.random() * 90000000).toString();
    const existing = await db.posDevice.findUnique({ where: { deviceKey } });
    if (!existing) {
      isUnique = true;
    }
  }

  return db.posDevice.create({
    data: {
      name: data.name,
      deviceKey,
      isActive: data.isActive !== undefined ? data.isActive : true,
      branchId: data.branchId
    },
    include: {
      branch: true
    }
  });
};

const remove = async (db, id) => {
  const device = await db.posDevice.findUnique({ where: { id } });
  if (!device) throw new ApiError(404, "POS Device not found");
  return db.posDevice.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  remove,
};
