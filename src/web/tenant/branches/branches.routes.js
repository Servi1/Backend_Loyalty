const { Router } = require("express");
const ctrl = require("./branches.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getById);
router.post("/", authorize("SUPER_ADMIN"), ctrl.create);
router.put("/:id", authorize("SUPER_ADMIN", "ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.update);
router.delete("/:id", authorize("SUPER_ADMIN"), ctrl.remove);

module.exports = router;
