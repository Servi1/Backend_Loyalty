const { Router } = require("express");
const ctrl = require("./tenants.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", authorize("SUPER_ADMIN"), ctrl.getAll);
router.get("/:id", authorize("SUPER_ADMIN"), ctrl.getById);
router.post("/", authorize("SUPER_ADMIN"), ctrl.create);
router.put("/:id", authorize("SUPER_ADMIN"), ctrl.update);
router.delete("/:id", authorize("SUPER_ADMIN"), ctrl.remove);

module.exports = router;
