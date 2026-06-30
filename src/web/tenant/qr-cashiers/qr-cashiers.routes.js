const { Router } = require("express");
const ctrl = require("./qr-cashiers.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.get("/", ctrl.getAll);
router.post("/", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.create);
router.put("/:id", authenticate, authorize("SUPER_ADMIN", "ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.update);
router.delete("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.remove);

module.exports = router;
