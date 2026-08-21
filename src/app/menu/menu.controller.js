/**
 * App Menu Controller
 *
 * GET /menu          → full menu (categories + items)
 * GET /menu/:itemId  → single item detail
 */

const catchAsync = require("../../utils/catchAsync");
const menuService = require("./menu.service");
const { getAppImageURL } = require("../../config");

const getMenu = catchAsync(async (req, res) => {
  const menu = await menuService.getMenu(req.tenantDb);
  const resolvedMenu = menu.map(category => ({
    ...category,
    items: category.items ? category.items.map(item => ({
      ...item,
      imageUrl: getAppImageURL(item.imageUrl),
      specialists: item.specialists ? item.specialists.map(s => ({
        ...s,
        avatarUrl: getAppImageURL(s.avatarUrl)
      })) : []
    })) : []
  }));
  res.json({ success: true, data: resolvedMenu });
});

const getItem = catchAsync(async (req, res) => {
  const item = await menuService.getItem(req.tenantDb, req.params.itemId);
  if (item) {
    item.imageUrl = getAppImageURL(item.imageUrl);
    if (item.specialists) {
      item.specialists = item.specialists.map(s => ({
        ...s,
        avatarUrl: getAppImageURL(s.avatarUrl)
      }));
    }
  }
  res.json({ success: true, data: item });
});

module.exports = { getMenu, getItem };

