const { Router } = require("express");
const ctrl = require("./discounts.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", ctrl.getAll);
router.post("/", authorize("SUPER_ADMIN", "ADMIN", "BRAND_MANAGER"), ctrl.create);
router.put("/:id", authorize("SUPER_ADMIN", "ADMIN", "BRAND_MANAGER"), ctrl.update);
router.delete("/:id", authorize("SUPER_ADMIN", "ADMIN", "BRAND_MANAGER"), ctrl.remove);

module.exports = router;
