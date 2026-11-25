/**
 * App Menu Service
 *
 * getMenu        — all categories with their available items (sorted)
 * getItem        — single item detail
 * getBranches    — all active branches with open status
 */

const ApiError = require("../../utils/ApiError");

const isItemAvailableAtBranch = (item, bId) => {
  if (!bId) return true;
  let bIds = [];
  if (Array.isArray(item.branchIds)) {
    bIds = item.branchIds;
  } else if (typeof item.branchIds === "string") {
    try {
      const parsed = JSON.parse(item.branchIds);
      if (Array.isArray(parsed)) bIds = parsed;
    } catch (e) {}
  }
  if (bIds.length > 0) {
    return bIds.includes(bId);
  }
  if (item.branchId) {
    return item.branchId === bId;
  }
  return true;
};

// ─── getMenu ──────────────────────────────────────────────────────────────────

const getMenu = async (db, branchId = null) => {
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
          branchId: true,
          branchIds: true,
          specialists: {
            include: {
              schedules: true
            }
          }
        }
      },
    },
  });
  return categories.map((cat) => ({
    ...cat,
    items: (cat.items || [])
      .filter((item) => isItemAvailableAtBranch(item, branchId))
      .map((item) => ({
        ...item,
        nameAr: item.nameAr || null,
        descriptionAr: item.descriptionAr || null,
      })),
  }));
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
