const { Router } = require("express");
const ctrl = require("./warehouses.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

const allowedRoles = ["ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM", "WAREHOUSE_MANAGER"];

router.get("/", authorize(...allowedRoles), ctrl.getAll);
router.post("/", authorize("ADMIN", "BRAND_MANAGER"), ctrl.create);
router.patch("/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.update);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.remove);

module.exports = router;
