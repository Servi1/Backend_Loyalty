/**
 * App Orders Routes
 *
 *   POST /api/app/:tenantId/orders            → place order
 *   GET  /api/app/:tenantId/orders            → my orders (paginated)
 *   GET  /api/app/:tenantId/orders/:orderId   → order detail
 *
 * All routes require authentication + CUSTOMER role.
 */

const { Router } = require("express");
const ctrl = require("./orders.controller");
const { authenticateAppUser } = require("../middlewares/appAuth.middleware");
const { requireAppTenant } = require("../middlewares/appTenant.middleware");

const router = Router();

// Public checkout for guest ordering via QR code
router.post("/public", requireAppTenant, ctrl.placePublic);

router.use(authenticateAppUser);

router.post("/", requireAppTenant, ctrl.place);
router.get("/", ctrl.myOrders);
router.get("/:orderId", ctrl.getOne);

module.exports = router;
