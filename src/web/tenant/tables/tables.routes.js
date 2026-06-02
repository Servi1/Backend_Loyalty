const { Router } = require("express");
const ctrl = require("./tables.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

// Public — customer app can look up table details if they scan a QR
router.get("/", ctrl.getAll);

// Protected — only brand/branch managers or admins can manage tables
router.post("/", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.create);
router.delete("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.remove);

module.exports = router;
