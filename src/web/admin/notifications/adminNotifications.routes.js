const { Router } = require("express");
const ctrl = require("./adminNotifications.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

// Protect all admin notification routes with super admin auth
router.use(authenticate, authorize("SUPER_ADMIN"));

router.get("/status", ctrl.getStatus);
router.get("/history", ctrl.getHistory);
router.post("/broadcast", ctrl.sendBroadcast);
router.delete("/history/:id", ctrl.deleteHistory);

module.exports = router;
