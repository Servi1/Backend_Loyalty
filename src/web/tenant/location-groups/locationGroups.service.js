const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  return db.locationGroup.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data) => {
  return db.locationGroup.create({
    data: {
      name: data.name,
      locations: data.locations || [],
    }
  });
};

const update = async (db, id, data) => {
  const group = await db.locationGroup.findUnique({ where: { id } });
  if (!group) throw new ApiError(404, "Location group not found");

  return db.locationGroup.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : group.name,
      locations: data.locations !== undefined ? data.locations : group.locations,
    }
  });
};

const remove = async (db, id) => {
  const group = await db.locationGroup.findUnique({ where: { id } });
  if (!group) throw new ApiError(404, "Location group not found");

  return db.locationGroup.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove,
};
