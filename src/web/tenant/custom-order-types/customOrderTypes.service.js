const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  return db.customOrderType.findMany({
    orderBy: {
      createdAt: "asc"
    }
  });
};

const create = async (db, data) => {
  return db.customOrderType.create({
    data: {
      name: data.name,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
    }
  });
};

const update = async (db, id, data) => {
  const item = await db.customOrderType.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Custom order type not found");

  return db.customOrderType.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : item.name,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : item.isActive,
    }
  });
};

const remove = async (db, id) => {
  const item = await db.customOrderType.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Custom order type not found");

  return db.customOrderType.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove,
};
