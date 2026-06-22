const { Router } = require("express");
const ctrl = require("./adminUsers.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

router.use(authenticate);
router.use(authorize("SUPER_ADMIN")); // restrict to platform admins

router.route("/")
  .get(ctrl.getAll)
  .post(ctrl.create);

router.route("/:id")
  .put(ctrl.update)
  .delete(ctrl.remove);

module.exports = router;
