/**
 * App Profile Routes
 *
 *   PATCH  /api/app/:tenantId/profile   → update profile
 *   DELETE /api/app/:tenantId/profile   → delete account
 *
 * All routes require authentication + CUSTOMER role.
 */

const { Router } = require("express");
const ctrl = require("./profile.controller");
const { authenticate } = require("../../middlewares/authMiddleware");
const { requireCustomer } = require("../middlewares/appAuth.middleware");

const router = Router();

router.use(authenticate, requireCustomer);

router.patch("/", ctrl.update);
router.delete("/", ctrl.remove);

module.exports = router;
