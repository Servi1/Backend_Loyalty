const { Router } = require("express");
const ctrl = require("./tenants.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", authorize("ADMIN"), ctrl.getAll);
router.get("/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.getById);
router.post("/", authorize("ADMIN"), ctrl.create);
router.put("/:id", authorize("ADMIN"), ctrl.update);
router.delete("/:id", authorize("ADMIN"), ctrl.remove);

module.exports = router;
