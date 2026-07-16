const { Router } = require("express");
const ctrl = require("./product-requests.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

const allowedRoles = ["ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"];

router.get("/", authorize(...allowedRoles), ctrl.getAll);
router.post("/", authorize(...allowedRoles), ctrl.create);
router.patch("/:id/status", authorize(...allowedRoles), ctrl.updateStatus);
router.delete("/:id", authorize(...allowedRoles), ctrl.remove);

module.exports = router;
