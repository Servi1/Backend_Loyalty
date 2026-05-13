const { Router } = require("express");
const ctrl = require("./orders.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

// Customer creates an order
router.post("/", ctrl.create);

// Customer views their own orders
router.get("/mine", ctrl.getMyOrders);

// Branch staff views branch orders
router.get("/branch/:branchId", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"), ctrl.getByBranch);

// Update order status (cashier accepts / completes)
router.patch("/:id/status", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER"), ctrl.updateStatus);

module.exports = router;
