const ApiError = require("../../../utils/ApiError");

const getAll = async (db, branchId, startDate, endDate) => {
  const where = {};
  if (branchId) {
    where.branchId = branchId;
  }
  if (startDate || endDate) {
    where.updatedAt = {};
    if (startDate) where.updatedAt.gte = new Date(startDate);
    if (endDate) where.updatedAt.lte = new Date(endDate);
  }
  return db.inventoryItem.findMany({
    where,
    orderBy: {
      updatedAt: "desc"
    }
  });
};

const create = async (db, data) => {
  const branch = await db.branch.findUnique({ where: { id: data.branchId } });
  if (!branch) throw new ApiError(404, "Branch not found");

  return db.inventoryItem.create({
    data: {
      name: data.name,
      quantity: Number(data.quantity) || 0,
      unit: data.unit || "pcs",
      branchId: data.branchId
    }
  });
};

const update = async (db, id, data) => {
  const item = await db.inventoryItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Inventory item not found");

  return db.inventoryItem.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : item.name,
      quantity: data.quantity !== undefined ? Number(data.quantity) : item.quantity,
      unit: data.unit !== undefined ? data.unit : item.unit
    }
  });
};

const remove = async (db, id) => {
  const item = await db.inventoryItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Inventory item not found");

  return db.inventoryItem.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
