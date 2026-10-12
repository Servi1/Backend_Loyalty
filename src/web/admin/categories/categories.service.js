const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const defaultCategories = ["Cafe", "Kitchen", "Spa", "Restaurant", "Saloon"];

const seedDefaultCategoriesIfEmpty = async () => {
  try {
    const seeded = await mainPrisma.adminSetting.findUnique({
      where: { key: "initialTenantCategoriesSeeded" }
    });
    if (seeded) return;

    const count = await mainPrisma.tenantCategory.count();
    if (count === 0) {
      console.log("Seeding default Tenant Categories...");
      for (const name of defaultCategories) {
        const existing = await mainPrisma.tenantCategory.findFirst({
          where: { name: { equals: name, mode: "insensitive" } }
        });
        if (!existing) {
          await mainPrisma.tenantCategory.create({ data: { name } });
        }
      }
    }
    await mainPrisma.adminSetting.upsert({
      where: { key: "initialTenantCategoriesSeeded" },
      update: { value: "true" },
      create: { key: "initialTenantCategoriesSeeded", value: "true" }
    });
  } catch (err) {
    console.warn("Could not check/set initialTenantCategoriesSeeded setting:", err.message);
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
  const cleanName = (data.name || "").trim();
  if (!cleanName) {
    throw new ApiError(400, "Category name is required");
  }
  const existing = await mainPrisma.tenantCategory.findFirst({
    where: { name: { equals: cleanName, mode: "insensitive" } }
  });
  if (existing) {
    throw new ApiError(400, "Category already exists");
  }
  const created = await mainPrisma.tenantCategory.create({
    data: { name: cleanName }
  });
  if (data.nameAr) {
    const cleanAr = String(data.nameAr).trim();
    try {
      await mainPrisma.$executeRawUnsafe(
        'UPDATE "TenantCategory" SET "nameAr" = $1 WHERE id = $2',
        cleanAr || null,
        created.id
      );
      created.nameAr = cleanAr || null;
    } catch (e) {
      console.warn("Could not save nameAr for category:", e.message);
    }
  }
  return created;
};

const update = async (id, data) => {
  const cleanName = (data.name || "").trim();
  if (!cleanName) {
    throw new ApiError(400, "Category name is required");
  }
  const existing = await mainPrisma.tenantCategory.findFirst({
    where: { name: { equals: cleanName, mode: "insensitive" } }
  });
  if (existing && existing.id !== id) {
    throw new ApiError(400, "Category name already exists");
  }
  const updated = await mainPrisma.tenantCategory.update({
    where: { id },
    data: { name: cleanName }
  });
  if (data.nameAr !== undefined) {
    const cleanAr = data.nameAr ? String(data.nameAr).trim() : null;
    try {
      await mainPrisma.$executeRawUnsafe(
        'UPDATE "TenantCategory" SET "nameAr" = $1 WHERE id = $2',
        cleanAr || null,
        id
      );
      updated.nameAr = cleanAr || null;
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

  // Clean up disabledCategories setting if it contained this category
  try {
    const disabledSetting = await mainPrisma.adminSetting.findUnique({
      where: { key: "disabledCategories" }
    });
    if (disabledSetting && disabledSetting.value) {
      const list = disabledSetting.value.split(",").map(x => x.trim()).filter(Boolean);
      if (list.includes(existing.name)) {
        const updated = list.filter(x => x !== existing.name).join(",");
        await mainPrisma.adminSetting.update({
          where: { key: "disabledCategories" },
          data: { value: updated }
        });
      }
    }
  } catch (err) {
    console.warn("Could not clean up disabledCategories setting:", err.message);
  }

  return { success: true, message: "Category deleted successfully" };
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
