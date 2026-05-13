const { Router } = require("express");
const ctrl = require("./branches.controller");
const { authenticate, authorize } = require("../../middlewares/authMiddleware");
const { extractTenant } = require("../../middlewares/tenantMiddleware");

const router = Router();

router.use(authenticate);

router.get("/", extractTenant, ctrl.getByTenant);
router.get("/:id", ctrl.getById);
router.post("/", extractTenant, authorize("ADMIN", "BRAND_MANAGER"), ctrl.create);
router.put("/:id", authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER"), ctrl.update);
router.delete("/:id", authorize("ADMIN", "BRAND_MANAGER"), ctrl.remove);

module.exports = router;
