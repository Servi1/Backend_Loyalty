const { Router } = require("express");
const ctrl = require("./users.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.getAll);
router.post("/", authorize("ADMIN", "BRAND_MANAGER"), ctrl.create);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.remove);

module.exports = router;
