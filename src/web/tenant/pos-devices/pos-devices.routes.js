const { Router } = require("express");
const ctrl = require("./pos-devices.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.get("/", authenticate, ctrl.getAll);
router.post("/", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.create);
router.delete("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.remove);

module.exports = router;
