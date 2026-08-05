const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  // Fetch all global order types from super admin registry
  const globalTypes = await mainPrisma.globalOrderType.findMany();

  // Fetch local custom order types
  let tenantTypes = await db.customOrderType.findMany();

  // Sync global types to local database
  for (const gt of globalTypes) {
    const matchIndex = tenantTypes.findIndex(tt => tt.name.toLowerCase() === gt.name.toLowerCase());
    if (matchIndex === -1) {
      const created = await db.customOrderType.create({
        data: {
          name: gt.name,
          isActive: gt.isActive
        }
      });
      tenantTypes.push(created);
    } else {
      const tt = tenantTypes[matchIndex];
      // If global type is disabled, force local to be disabled too in DB
      if (!gt.isActive && tt.isActive) {
        const updated = await db.customOrderType.update({
          where: { id: tt.id },
          data: { isActive: false }
        });
        tenantTypes[matchIndex] = updated;
      }
    }
  }

  // Map to add isGlobalActive property
  const mappedTypes = tenantTypes.map(tt => {
    const gt = globalTypes.find(g => g.name.toLowerCase() === tt.name.toLowerCase());
    return {
      ...tt,
      isGlobalActive: gt ? gt.isActive : false
    };
  });

  // Sort by name
  return mappedTypes.sort((a, b) => a.name.localeCompare(b.name));
};

const create = async (db, data) => {
  throw new ApiError(403, "Adding new custom order types is restricted to Super Admins");
};

const update = async (db, id, data) => {
  const item = await db.customOrderType.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Custom order type not found");

  if (data.name !== undefined && data.name !== item.name) {
    throw new ApiError(403, "Modifying order type names is restricted to Super Admins");
  }

  if (data.isActive === true) {
    // Check if it is globally active
    const gt = await mainPrisma.globalOrderType.findFirst({
      where: { name: { equals: item.name, mode: "insensitive" } }
    });
    if (!gt || !gt.isActive) {
      throw new ApiError(403, "Cannot enable an order type that is disabled by the Super Admin");
    }
  }

  return db.customOrderType.update({
    where: { id },
    data: {
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : item.isActive,
    }
  });
};

const remove = async (db, id) => {
  throw new ApiError(403, "Deleting order types is restricted to Super Admins");
};

module.exports = {
  getAll,
  create,
  update,
  remove,
};
