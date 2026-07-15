const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const defaultCategories = ["Cafe", "Kitchen", "Spa", "Restaurant", "Saloon"];

const seedDefaultCategoriesIfEmpty = async () => {
  const count = await mainPrisma.tenantCategory.count();
  if (count === 0) {
    console.log("Seeding default Tenant Categories...");
    for (const name of defaultCategories) {
      await mainPrisma.tenantCategory.create({ data: { name } });
    }
  }
};

const getAll = async () => {
  await seedDefaultCategoriesIfEmpty();
  return mainPrisma.tenantCategory.findMany({
    orderBy: { name: "asc" }
  });
};

const create = async (data) => {
  if (!data.name) {
    throw new ApiError(400, "Category name is required");
  }
  const existing = await mainPrisma.tenantCategory.findUnique({
    where: { name: data.name }
  });
  if (existing) {
    throw new ApiError(400, "Category already exists");
  }
  return mainPrisma.tenantCategory.create({
    data: { name: data.name }
  });
};

const update = async (id, data) => {
  if (!data.name) {
    throw new ApiError(400, "Category name is required");
  }
  const existing = await mainPrisma.tenantCategory.findUnique({
    where: { name: data.name }
  });
  if (existing && existing.id !== id) {
    throw new ApiError(400, "Category name already exists");
  }
  return mainPrisma.tenantCategory.update({
    where: { id },
    data: { name: data.name }
  });
};

const remove = async (id) => {
  const existing = await mainPrisma.tenantCategory.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Category not found");
  }
  await mainPrisma.tenantCategory.delete({ where: { id } });
  return { success: true };
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
