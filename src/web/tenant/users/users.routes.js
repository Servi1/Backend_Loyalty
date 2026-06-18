const { Router } = require("express");
const ctrl = require("./users.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "CUSTOM"), ctrl.getAll);
router.post("/", authorize("ADMIN", "BRAND_MANAGER"), ctrl.create);
router.put("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.update);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.remove);

module.exports = router;
