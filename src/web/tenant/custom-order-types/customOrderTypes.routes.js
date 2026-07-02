const { Router } = require("express");
const ctrl = require("./customOrderTypes.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.get("/", authenticate, ctrl.getAll);
router.post("/", authenticate, authorize("ADMIN", "BRAND_MANAGER"), ctrl.create);
router.put("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER"), ctrl.update);
router.delete("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER"), ctrl.remove);

module.exports = router;
