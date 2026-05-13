const prisma = require("../../config/prisma");
const ApiError = require("../../utils/ApiError");

const getCategories = async () =>
  prisma.menuCategory.findMany({ orderBy: { order: "asc" }, include: { items: true } });

const getItemsByTenant = async (tenantId) =>
  prisma.menuItem.findMany({ where: { tenantId }, include: { category: true } });

const createCategory = async (data) => prisma.menuCategory.create({ data });

const createItem = async (data) => prisma.menuItem.create({ data });

const updateItem = async (id, data) => {
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  return prisma.menuItem.update({ where: { id }, data });
};

const toggleAvailability = async (id) => {
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  return prisma.menuItem.update({ where: { id }, data: { isAvailable: !item.isAvailable } });
};

const removeItem = async (id) => {
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  return prisma.menuItem.delete({ where: { id } });
};

module.exports = { getCategories, getItemsByTenant, createCategory, createItem, updateItem, toggleAvailability, removeItem };
