const ApiError = require("../../../utils/ApiError");

const getAll = async (db) =>
  db.branch.findMany({ include: { _count: { select: { tables: true, orders: true, staff: true } } } });

const getById = async (db, id) => {
  const branch = await db.branch.findUnique({ where: { id }, include: { tables: true, staff: true } });
  if (!branch) throw new ApiError(404, "Branch not found");
  return branch;
};

const create = async (db, data) => db.branch.create({ data });

const update = async (db, id, data) => {
  await getById(db, id);
  return db.branch.update({ where: { id }, data });
};

const remove = async (db, id) => {
  await getById(db, id);
  return db.branch.delete({ where: { id } });
};

module.exports = { getAll, getById, create, update, remove };
