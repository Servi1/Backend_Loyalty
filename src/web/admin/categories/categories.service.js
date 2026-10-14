const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const defaultCategories = ["Cafe", "Kitchen", "Spa", "Restaurant", "Saloon"];

const seedDefaultCategoriesIfEmpty = async () => {
  try {
    const seeded = await mainPrisma.systemSetting.findUnique({
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
      await mainPrisma.systemSetting.upsert({
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
    const disabledSetting = await mainPrisma.systemSetting.findUnique({
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

  const disabledSet = new Set(disabledList.map(x => x.toLowerCase().trim()));

  const enriched = categories.map(c => {
    const isInactive = disabledSet.has((c.name || "").toLowerCase().trim());
    return {
      id: c.id,
      name: c.name,
      nameAr: arMap.get(c.id) || c.nameAr || null,
      isActive: !isInactive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    };
  });

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
  const currentCategory = await mainPrisma.tenantCategory.findUnique({ where: { id } });
  if (!currentCategory) {
    throw new ApiError(404, "Category not found");
  }

  const oldName = currentCategory.name;
  let cleanName = oldName;

  if (data.name !== undefined) {
    cleanName = (data.name || "").trim();
    if (!cleanName) {
      throw new ApiError(400, "Category name cannot be empty");
    }
    const existing = await mainPrisma.tenantCategory.findFirst({
      where: { name: { equals: cleanName, mode: "insensitive" } }
    });
    if (existing && existing.id !== id) {
      throw new ApiError(400, "Category name already exists");
    }
  }

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
      const disabledSetting = await mainPrisma.systemSetting.findUnique({
        where: { key: "disabledCategories" }
      });
      if (disabledSetting && disabledSetting.value) {
        const list = disabledSetting.value.split(",").map(x => x.trim()).filter(Boolean);
        if (list.some(x => x.toLowerCase() === oldName.toLowerCase())) {
          const updatedList = list.map(x => (x.toLowerCase() === oldName.toLowerCase() ? cleanName : x)).join(",");
          await mainPrisma.systemSetting.update({
            where: { key: "disabledCategories" },
            data: { value: updatedList }
          });
        }
      }
    } catch (err) {
      console.warn("Failed to update disabledCategories setting on rename:", err.message);
    }
  }

  // Handle isActive toggle if provided
  if (data.isActive !== undefined) {
    try {
      const disabledSetting = await mainPrisma.systemSetting.findUnique({
        where: { key: "disabledCategories" }
      });
      const currentList = disabledSetting && disabledSetting.value
        ? disabledSetting.value.split(",").map(x => x.trim()).filter(Boolean)
        : [];

      let newList;
      if (data.isActive === false) {
        if (!currentList.some(x => x.toLowerCase() === cleanName.toLowerCase())) {
          newList = [...currentList, cleanName];
        } else {
          newList = currentList;
        }
      } else {
        newList = currentList.filter(x => x.toLowerCase() !== cleanName.toLowerCase());
      }

      await mainPrisma.systemSetting.upsert({
        where: { key: "disabledCategories" },
        update: { value: newList.join(",") },
        create: { key: "disabledCategories", value: newList.join(",") }
      });
    } catch (err) {
      console.warn("Failed to update disabledCategories setting on isActive toggle:", err.message);
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

  // Return category enriched with isActive
  let isCategoryActive = true;
  try {
    const disabledSetting = await mainPrisma.systemSetting.findUnique({
      where: { key: "disabledCategories" }
    });
    if (disabledSetting && disabledSetting.value) {
      const list = disabledSetting.value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
      isCategoryActive = !list.includes(cleanName.toLowerCase());
    }
  } catch (e) {}

  return {
    ...updated,
    isActive: isCategoryActive
  };
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
    const disabledSetting = await mainPrisma.systemSetting.findUnique({
      where: { key: "disabledCategories" }
    });
    if (disabledSetting && disabledSetting.value) {
      const list = disabledSetting.value.split(",").map(x => x.trim()).filter(Boolean);
      if (list.some(x => x.toLowerCase() === existing.name.toLowerCase())) {
        const updated = list.filter(x => x.toLowerCase() !== existing.name.toLowerCase()).join(",");
        await mainPrisma.systemSetting.update({
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
