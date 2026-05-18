const ApiError = require("../../utils/ApiError");

const getCategories = async (db) =>
  db.menuCategory.findMany({ orderBy: { order: "asc" }, include: { items: true } });

const getItems = async (db) =>
  db.menuItem.findMany({ include: { category: true } });

const createCategory = async (db, data) => db.menuCategory.create({ data });

const createItem = async (db, data) => db.menuItem.create({ data });

const updateItem = async (db, id, data) => {
  const item = await db.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  return db.menuItem.update({ where: { id }, data });
};

const toggleAvailability = async (db, id) => {
  const item = await db.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  return db.menuItem.update({ where: { id }, data: { isAvailable: !item.isAvailable } });
};

const removeItem = async (db, id) => {
  const item = await db.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  return db.menuItem.delete({ where: { id } });
};

module.exports = { getCategories, getItems, createCategory, createItem, updateItem, toggleAvailability, removeItem };
