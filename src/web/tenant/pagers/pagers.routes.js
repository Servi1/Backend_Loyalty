const { Router } = require("express");
const ctrl = require("./pagers.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

const router = Router();

// Staff authentication applies to tenant pager management
router.get("/", authenticate, ctrl.getAll);
router.get("/:id", authenticate, ctrl.getById);
router.post("/", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "SUPER_ADMIN"), ctrl.create);
router.post("/:id/renew", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "SUPER_ADMIN"), ctrl.renew);
router.put("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "SUPER_ADMIN"), ctrl.update);
router.patch("/:id", authenticate, authorize("ADMIN", "BRAND_MANAGER", "BRANCH_MANAGER", "SUPER_ADMIN"), ctrl.update);

// Live tickets queue management
router.get("/:id/tickets", authenticate, ctrl.getTickets);
router.patch("/:id/tickets/:ticketId/status", authenticate, ctrl.updateTicketStatus);
router.get("/:id/active-orders", authenticate, ctrl.getActiveOrders);

module.exports = router;

