const ApiError = require("../../../utils/ApiError");
const mainPrisma = require("../../../config/prisma");

const getCategories = async (db) =>
  db.menuCategory.findMany({ orderBy: { order: "asc" }, include: { items: true } });

const getItems = async (db, startDate, endDate) => {
  const where = {};
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }
  return db.menuItem.findMany({ where, include: { category: true } });
};

const createCategory = async (db, data) => db.menuCategory.create({ data });

const syncGlobalSpinItem = async (tenantId, item) => {
  if (!tenantId || !item) return;
  if (item.spinEnabled) {
    await mainPrisma.globalSpinItem.upsert({
      where: {
        tenantId_menuItemId: {
          tenantId,
          menuItemId: item.id
        }
      },
      create: {
        tenantId,
        menuItemId: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        imageUrl: item.imageUrl,
        spinDailyLimit: item.spinDailyLimit || 0,
        spinTotalLimit: item.spinTotalLimit || 0,
        isActive: item.isAvailable
      },
      update: {
        name: item.name,
        description: item.description,
        price: item.price,
        imageUrl: item.imageUrl,
        spinDailyLimit: item.spinDailyLimit || 0,
        spinTotalLimit: item.spinTotalLimit || 0,
        isActive: item.isAvailable
      }
    });
  } else {
    await mainPrisma.globalSpinItem.deleteMany({
      where: {
        tenantId,
        menuItemId: item.id
      }
    });
  }
};

const createItem = async (db, data, tenantId) => {
  const item = await db.menuItem.create({ data });
  await syncGlobalSpinItem(tenantId, item);
  return item;
};

const updateItem = async (db, id, data, tenantId) => {
  const item = await db.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  const updated = await db.menuItem.update({ where: { id }, data });
  await syncGlobalSpinItem(tenantId, updated);
  return updated;
};

const toggleAvailability = async (db, id, tenantId) => {
  const item = await db.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  const updated = await db.menuItem.update({ where: { id }, data: { isAvailable: !item.isAvailable } });
  if (updated.spinEnabled) {
    await mainPrisma.globalSpinItem.updateMany({
      where: { tenantId, menuItemId: id },
      data: { isActive: updated.isAvailable }
    });
  }
  return updated;
};

const removeItem = async (db, id, tenantId) => {
  const item = await db.menuItem.findUnique({ where: { id } });
  if (!item) throw new ApiError(404, "Menu item not found");
  await mainPrisma.globalSpinItem.deleteMany({
    where: {
      tenantId,
      menuItemId: id
    }
  });
  return db.menuItem.delete({ where: { id } });
};

const updateCategory = async (db, id, data) => {
  const cat = await db.menuCategory.findUnique({ where: { id } });
  if (!cat) throw new ApiError(404, "Category not found");
  return db.menuCategory.update({ where: { id }, data });
};

const removeCategory = async (db, id, tenantId) => {
  const cat = await db.menuCategory.findUnique({ where: { id }, include: { items: true } });
  if (!cat) throw new ApiError(404, "Category not found");
  
  if (cat.items && cat.items.length > 0) {
    const itemIds = cat.items.map((i) => i.id);
    await mainPrisma.globalSpinItem.deleteMany({
      where: {
        tenantId,
        menuItemId: { in: itemIds }
      }
    });
    await db.menuItem.deleteMany({
      where: { categoryId: id }
    });
  }

  return db.menuCategory.delete({ where: { id } });
};

module.exports = { 
  getCategories, 
  getItems, 
  createCategory, 
  updateCategory,
  removeCategory,
  createItem, 
  updateItem, 
  toggleAvailability, 
  removeItem 
};
