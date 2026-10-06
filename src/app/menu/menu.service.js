/**
 * App Menu Service
 *
 * getMenu        — all categories with their available items (sorted)
 * getItem        — single item detail
 * getBranches    — all active branches with open status
 */

const ApiError = require("../../utils/ApiError");

// ─── getMenu ──────────────────────────────────────────────────────────────────

const getMenu = async (db) => {
  const categories = await db.menuCategory.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      nameAr: true,
      imageUrl: true,
      iconUrl: true,
      order: true,
      items: {
        where: { isAvailable: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          nameAr: true,
          description: true,
          descriptionAr: true,
          price: true,
          imageUrl: true,
          isAvailable: true,
          categoryId: true,
          createdAt: true,
          updatedAt: true,
          isChefPick: true,
          rating: true,
          modifiers: true,
          prepTime: true,
          specialists: {
            include: {
              schedules: true
            }
          }
        }
      },
    },
  });
  return categories;
};

// ─── getItem ──────────────────────────────────────────────────────────────────

const getItem = async (db, itemId) => {
  const item = await db.menuItem.findUnique({
    where: { id: itemId },
    include: { category: true },
  });
  if (!item) throw new ApiError(404, "Menu item not found");
  return item;
};

module.exports = { getMenu, getItem };
