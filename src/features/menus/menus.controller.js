const catchAsync = require("../../utils/catchAsync");
const menusService = require("./menus.service");

const getCategories = catchAsync(async (_req, res) => {
  const categories = await menusService.getCategories();
  res.json({ success: true, data: categories });
});

const getItems = catchAsync(async (req, res) => {
  const items = await menusService.getItemsByTenant(req.tenantId);
  res.json({ success: true, data: items });
});

const createCategory = catchAsync(async (req, res) => {
  const category = await menusService.createCategory(req.body);
  res.status(201).json({ success: true, data: category });
});

const createItem = catchAsync(async (req, res) => {
  const item = await menusService.createItem({ ...req.body, tenantId: req.tenantId });
  res.status(201).json({ success: true, data: item });
});

const updateItem = catchAsync(async (req, res) => {
  const item = await menusService.updateItem(req.params.id, req.body);
  res.json({ success: true, data: item });
});

const toggleAvailability = catchAsync(async (req, res) => {
  const item = await menusService.toggleAvailability(req.params.id);
  res.json({ success: true, data: item });
});

const removeItem = catchAsync(async (req, res) => {
  await menusService.removeItem(req.params.id);
  res.status(204).send();
});

module.exports = { getCategories, getItems, createCategory, createItem, updateItem, toggleAvailability, removeItem };
