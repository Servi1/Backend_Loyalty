const catchAsync = require("../../utils/catchAsync");
const tenantsService = require("./tenants.service");

const getAll = catchAsync(async (_req, res) => {
  const tenants = await tenantsService.getAll();
  res.json({ success: true, data: tenants });
});

const getById = catchAsync(async (req, res) => {
  const tenant = await tenantsService.getById(req.params.id);
  res.json({ success: true, data: tenant });
});

const create = catchAsync(async (req, res) => {
  const tenant = await tenantsService.create(req.body);
  res.status(201).json({ success: true, data: tenant });
});

const update = catchAsync(async (req, res) => {
  const tenant = await tenantsService.update(req.params.id, req.body);
  res.json({ success: true, data: tenant });
});

const remove = catchAsync(async (req, res) => {
  await tenantsService.remove(req.params.id);
  res.status(204).send();
});

const getProfile = catchAsync(async (req, res) => {
  res.json({ success: true, data: req.tenant });
});

const getOverview = catchAsync(async (_req, res) => {
  const overview = await tenantsService.getOverview();
  res.json({ success: true, data: overview });
});

const getSubscriptions = catchAsync(async (_req, res) => {
  const subscriptions = await tenantsService.getSubscriptions();
  res.json({ success: true, data: subscriptions });
});

const getLoyaltyOverview = catchAsync(async (_req, res) => {
  const loyalty = await tenantsService.getLoyaltyOverview();
  res.json({ success: true, data: loyalty });
});

const getInvoices = catchAsync(async (_req, res) => {
  const invoices = await tenantsService.getInvoices();
  res.json({ success: true, data: invoices });
});

const updateProfile = catchAsync(async (req, res) => {
  const updated = await tenantsService.update(req.tenant.id, req.body);
  res.json({ success: true, data: updated });
});

const getSuperAdminOrders = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const status = req.query.status;

  const result = await tenantsService.getSuperAdminOrders({ status, page, limit });
  res.json({ success: true, data: result });
});

const getSuperAdminCustomers = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const search = req.query.search || "";

  const result = await tenantsService.getSuperAdminCustomers({ search, page, limit });
  res.json({ success: true, data: result });
});

const getSuperAdminCustomerDetails = catchAsync(async (req, res) => {
  const { tenantId, customerId } = req.params;
  const result = await tenantsService.getSuperAdminCustomerDetails(tenantId, customerId);
  res.json({ success: true, data: result });
});

const addSuperAdminCustomer = catchAsync(async (req, res) => {
  const customer = await tenantsService.addSuperAdminCustomer(req.body);
  res.status(201).json({ success: true, data: customer });
});

const deleteSuperAdminCustomer = catchAsync(async (req, res) => {
  const { tenantId, customerId } = req.params;
  await tenantsService.deleteSuperAdminCustomer(tenantId, customerId);
  res.status(204).send();
});

const getTenantUsers = catchAsync(async (req, res) => {
  const users = await tenantsService.getTenantUsers(req.params.id);
  res.json({ success: true, data: users });
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getProfile,
  updateProfile,
  getOverview,
  getSubscriptions,
  getLoyaltyOverview,
  getInvoices,
  getSuperAdminOrders,
  getSuperAdminCustomers,
  getSuperAdminCustomerDetails,
  addSuperAdminCustomer,
  deleteSuperAdminCustomer,
  getTenantUsers
};
