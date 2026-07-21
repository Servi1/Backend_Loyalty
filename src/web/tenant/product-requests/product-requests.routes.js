const { Router } = require("express");
const ctrl = require("./product-requests.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

const allowedRoles = ["ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM", "WAREHOUSE_MANAGER"];

router.get("/", authorize(...allowedRoles), ctrl.getAll);
router.post("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CUSTOM"), ctrl.create);
router.patch("/:id/status", authorize("ADMIN", "WAREHOUSE_MANAGER"), ctrl.updateStatus);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.remove);

module.exports = router;
