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
  const categories = await mainPrisma.tenantCategory.findMany({
    orderBy: { name: "asc" }
  });
  try {
    const rawWithAr = await mainPrisma.$queryRawUnsafe('SELECT id, "nameAr" FROM "TenantCategory"');
    const arMap = new Map(rawWithAr.map(r => [r.id, r.nameAr]));
    return categories.map(c => ({
      ...c,
      nameAr: arMap.get(c.id) || null
    }));
  } catch (e) {
    return categories;
  }
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
  const created = await mainPrisma.tenantCategory.create({
    data: { name: data.name }
  });
  if (data.nameAr) {
    try {
      await mainPrisma.$executeRawUnsafe(
        'UPDATE "TenantCategory" SET "nameAr" = $1 WHERE id = $2',
        data.nameAr,
        created.id
      );
      created.nameAr = data.nameAr;
    } catch (e) {
      console.warn("Could not save nameAr for category:", e.message);
    }
  }
  return created;
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
  const updated = await mainPrisma.tenantCategory.update({
    where: { id },
    data: { name: data.name }
  });
  if (data.nameAr !== undefined) {
    try {
      await mainPrisma.$executeRawUnsafe(
        'UPDATE "TenantCategory" SET "nameAr" = $1 WHERE id = $2',
        data.nameAr || null,
        id
      );
      updated.nameAr = data.nameAr || null;
    } catch (e) {
      console.warn("Could not update nameAr for category:", e.message);
    }
  }
  return updated;
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
