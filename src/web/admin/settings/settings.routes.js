const { Router } = require("express");
const ctrl = require("./settings.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

// Protect settings with super admin authentication and authorization
router.use(authenticate, authorize("SUPER_ADMIN"));

router.get("/", ctrl.getSettings);
router.put("/", ctrl.updateSettings);

router.get("/app-content", ctrl.getAppContent);
router.put("/app-content", ctrl.updateAppContent);

module.exports = router;
