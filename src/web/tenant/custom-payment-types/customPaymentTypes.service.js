const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  return db.customPaymentType.findMany({
    orderBy: {
      createdAt: "asc"
    }
  });
};

const create = async (db, data) => {
  return db.customPaymentType.create({
    data: {
      name: data.name,
      imageUrl: data.imageUrl || null,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
    }
  });
};

const update = async (db, id, data) => {
  const item = await db.customPaymentType.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Custom payment type not found");

  return db.customPaymentType.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : item.name,
      imageUrl: data.imageUrl !== undefined ? data.imageUrl : item.imageUrl,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : item.isActive,
    }
  });
};

const remove = async (db, id) => {
  const item = await db.customPaymentType.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Custom payment type not found");

  return db.customPaymentType.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove,
};
