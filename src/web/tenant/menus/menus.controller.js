const catchAsync = require("../../../utils/catchAsync");
const menusService = require("./menus.service");

const getCategories = catchAsync(async (req, res) => {
  const categories = await menusService.getCategories(req.tenantDb);
  res.json({ success: true, data: categories });
});

const getItems = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const items = await menusService.getItems(req.tenantDb, startDate, endDate);
  res.json({ success: true, data: items });
});

const createCategory = catchAsync(async (req, res) => {
  const category = await menusService.createCategory(req.tenantDb, req.body);
  res.status(201).json({ success: true, data: category });
});

const createItem = catchAsync(async (req, res) => {
  const { tenantId } = req.params;
  const item = await menusService.createItem(req.tenantDb, req.body, tenantId);
  res.status(201).json({ success: true, data: item });
});

const updateItem = catchAsync(async (req, res) => {
  const { tenantId } = req.params;
  const item = await menusService.updateItem(req.tenantDb, req.params.id, req.body, tenantId);
  res.json({ success: true, data: item });
});

const toggleAvailability = catchAsync(async (req, res) => {
  const { tenantId } = req.params;
  const item = await menusService.toggleAvailability(req.tenantDb, req.params.id, tenantId);
  res.json({ success: true, data: item });
});

const updateCategory = catchAsync(async (req, res) => {
  const category = await menusService.updateCategory(req.tenantDb, req.params.id, req.body);
  res.json({ success: true, data: category });
});

const removeCategory = catchAsync(async (req, res) => {
  const { tenantId } = req.params;
  await menusService.removeCategory(req.tenantDb, req.params.id, tenantId);
  res.status(204).send();
});

const removeItem = catchAsync(async (req, res) => {
  const { tenantId } = req.params;
  await menusService.removeItem(req.tenantDb, req.params.id, tenantId);
  res.status(204).send();
});

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
