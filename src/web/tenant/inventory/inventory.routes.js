const { Router } = require("express");
const ctrl = require("./inventory.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

// Branch Manager, Brand Manager, Admin, and B2B staff can access/manipulate inventory
router.get("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"), ctrl.getAll);
router.post("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"), ctrl.create);
router.patch("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"), ctrl.update);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"), ctrl.remove);

module.exports = router;
