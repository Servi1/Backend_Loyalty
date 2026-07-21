const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  return db.warehouse.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data) => {
  if (!data.name) {
    throw new ApiError(400, "Warehouse name is required");
  }
  return db.warehouse.create({
    data: {
      name: data.name,
      location: data.location || null,
      isActive: data.isActive !== undefined ? data.isActive : true
    }
  });
};

const update = async (db, id, data) => {
  const warehouse = await db.warehouse.findUnique({ where: { id } });
  if (!warehouse) {
    throw new ApiError(404, "Warehouse not found");
  }
  return db.warehouse.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : warehouse.name,
      location: data.location !== undefined ? data.location : warehouse.location,
      isActive: data.isActive !== undefined ? data.isActive : warehouse.isActive
    }
  });
};

const remove = async (db, id) => {
  const warehouse = await db.warehouse.findUnique({ where: { id } });
  if (!warehouse) {
    throw new ApiError(404, "Warehouse not found");
  }
  return db.warehouse.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
