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
const { authenticate } = require("../../middlewares/authMiddleware");
const { requireCustomer } = require("../middlewares/appAuth.middleware");

const router = Router();

// Public checkout for guest ordering via QR code
router.post("/public", ctrl.placePublic);

router.use(authenticate, requireCustomer);

router.post("/", ctrl.place);
router.get("/", ctrl.myOrders);
router.get("/:orderId", ctrl.getOne);

module.exports = router;
