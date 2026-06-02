const { Router } = require("express");
const ctrl = require("./inventory.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);

// Branch Manager, Brand Manager, and Admin can access/manipulate inventory
router.get("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.getAll);
router.post("/", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.create);
router.patch("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.update);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.remove);

module.exports = router;
