const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const defaultCategories = ["Cafe", "Kitchen", "Spa", "Restaurant", "Saloon"];

const seedDefaultCategoriesIfEmpty = async () => {
  try {
    const seeded = await mainPrisma.adminSetting.findUnique({
      where: { key: "initialTenantCategoriesSeeded" }
    });
    if (!seeded) {
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
    }
  } catch (err) {
    console.warn("Could not check/set initialTenantCategoriesSeeded setting:", err.message);
  }
};

const getAll = async (options = {}) => {
  await seedDefaultCategoriesIfEmpty();
  const categories = await mainPrisma.tenantCategory.findMany({
    orderBy: { name: "asc" }
  });

  let disabledList = [];
  try {
    const disabledSetting = await mainPrisma.adminSetting.findUnique({
      where: { key: "disabledCategories" }
    });
    if (disabledSetting && disabledSetting.value) {
      disabledList = disabledSetting.value.split(",").map(x => x.trim()).filter(Boolean);
    }
  } catch (err) {
    console.warn("Could not load disabledCategories setting:", err.message);
  }

  let rawWithAr = [];
  try {
    rawWithAr = await mainPrisma.$queryRawUnsafe('SELECT id, "nameAr" FROM "TenantCategory"');
  } catch (e) {}
  const arMap = new Map(rawWithAr.map(r => [r.id, r.nameAr]));

  const enriched = categories.map(c => ({
    ...c,
    nameAr: arMap.get(c.id) || null,
    isActive: !disabledList.includes(c.name)
  }));

  if (options.activeOnly) {
    return enriched.filter(c => c.isActive);
  }

  return enriched;
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

  const currentCategory = await mainPrisma.tenantCategory.findUnique({ where: { id } });
  const oldName = currentCategory?.name;

  const updated = await mainPrisma.tenantCategory.update({
    where: { id },
    data: { name: cleanName }
  });

  // Cascade category rename to all Tenants currently assigned to this category
  if (oldName && oldName !== cleanName) {
    try {
      await mainPrisma.tenant.updateMany({
        where: { category: oldName },
        data: { category: cleanName }
      });
    } catch (err) {
      console.warn(`Failed to cascade category rename from '${oldName}' to '${cleanName}' on tenants:`, err.message);
    }

    // Also update disabledCategories setting if the old name was listed
    try {
      const disabledSetting = await mainPrisma.adminSetting.findUnique({
        where: { key: "disabledCategories" }
      });
      if (disabledSetting && disabledSetting.value) {
        const list = disabledSetting.value.split(",").map(x => x.trim()).filter(Boolean);
        if (list.includes(oldName)) {
          const updatedList = list.map(x => (x === oldName ? cleanName : x)).join(",");
          await mainPrisma.adminSetting.update({
            where: { key: "disabledCategories" },
            data: { value: updatedList }
          });
        }
      }
    } catch (err) {
      console.warn("Failed to update disabledCategories setting on rename:", err.message);
    }
  }

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

  // Cascade deletion to Tenants table by setting their category to null
  try {
    await mainPrisma.tenant.updateMany({
      where: { category: existing.name },
      data: { category: null }
    });
  } catch (err) {
    console.warn(`Failed to clear category '${existing.name}' from tenants:`, err.message);
  }

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
