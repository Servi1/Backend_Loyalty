const { Router } = require("express");
const ctrl = require("./menus.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");
const { extractTenant } = require("../../middlewares/tenantMiddleware");

const router = Router();

// Public — customers can browse menus
router.get("/categories", ctrl.getCategories);
router.get("/items", extractTenant, ctrl.getItems);

// Protected — only brand/branch managers can mutate
router.use(authenticate);
router.post("/categories", authorize("ADMIN", "BRAND_MANAGER"), ctrl.createCategory);
router.post("/items", extractTenant, authorize("ADMIN", "BRAND_MANAGER"), ctrl.createItem);
router.put("/items/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.updateItem);
router.patch("/items/:id/toggle", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.toggleAvailability);
router.delete("/items/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.removeItem);

module.exports = router;
