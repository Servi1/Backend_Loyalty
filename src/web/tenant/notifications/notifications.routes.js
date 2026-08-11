const { Router } = require("express");
const ctrl = require("./notifications.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.post("/orders/:id/remind-whatsapp", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "CUSTOM"), ctrl.remindWhatsApp);
router.post("/orders/:id/remind-email", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "CUSTOM"), ctrl.remindEmail);

module.exports = router;
