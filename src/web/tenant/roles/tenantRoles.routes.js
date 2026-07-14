const { Router } = require("express");
const ctrl = require("./tenantRoles.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use(authorize("BRAND_MANAGER")); // Restrict to Brand Managers

router.route("/")
  .get(ctrl.getAll)
  .post(ctrl.create);

router.route("/:id")
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
