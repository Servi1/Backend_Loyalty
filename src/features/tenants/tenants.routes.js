const { Router } = require("express");
const ctrl = require("./tenants.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");
const { extractTenant } = require("../../middlewares/tenantMiddleware");

const router = Router();

// Profile endpoints for active tenant owner/staff
router.get("/profile/me", authenticate, extractTenant, ctrl.getProfile);
router.put("/profile/me", authenticate, extractTenant, ctrl.updateProfile);

// Admin-only endpoints
router.use(authenticate);
router.get("/overview", authorize("SUPER_ADMIN"), ctrl.getOverview);
router.get("/orders", authorize("SUPER_ADMIN"), ctrl.getSuperAdminOrders);
router.get("/subscriptions", authorize("SUPER_ADMIN"), ctrl.getSubscriptions);
router.get("/loyalty", authorize("SUPER_ADMIN"), ctrl.getLoyaltyOverview);
router.get("/loyalty/customers", authorize("SUPER_ADMIN"), ctrl.getSuperAdminCustomers);
router.post("/loyalty/customers", authorize("SUPER_ADMIN"), ctrl.addSuperAdminCustomer);
router.get("/loyalty/customers/:tenantId/:customerId", authorize("SUPER_ADMIN"), ctrl.getSuperAdminCustomerDetails);
router.delete("/loyalty/customers/:tenantId/:customerId", authorize("SUPER_ADMIN"), ctrl.deleteSuperAdminCustomer);
router.get("/invoices", authorize("SUPER_ADMIN"), ctrl.getInvoices);
router.get("/users/all", authorize("SUPER_ADMIN"), ctrl.getAllSystemUsers);
router.get("/:id/users", authorize("SUPER_ADMIN"), ctrl.getTenantUsers);
router.get("/", authorize("SUPER_ADMIN"), ctrl.getAll);
router.get("/:id", authorize("SUPER_ADMIN"), ctrl.getById);
router.post("/", authorize("SUPER_ADMIN"), ctrl.create);
router.put("/:id", authorize("SUPER_ADMIN"), ctrl.update);
router.delete("/:id", authorize("SUPER_ADMIN"), ctrl.remove);

module.exports = router;
