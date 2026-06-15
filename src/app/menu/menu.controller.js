/**
 * App Menu Controller
 *
 * GET /menu          → full menu (categories + items)
 * GET /menu/:itemId  → single item detail
 */

const catchAsync = require("../../utils/catchAsync");
const menuService = require("./menu.service");

const getMenu = catchAsync(async (req, res) => {
  const menu = await menuService.getMenu(req.tenantDb);
  res.json({ success: true, data: menu });
});

const getItem = catchAsync(async (req, res) => {
  const item = await menuService.getItem(req.tenantDb, req.params.itemId);
  res.json({ success: true, data: item });
});

module.exports = { getMenu, getItem };
