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
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: { name: "asc" },
        include: {
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
