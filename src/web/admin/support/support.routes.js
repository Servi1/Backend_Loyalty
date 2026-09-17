const express = require("express");
const router = express.Router();
const ctrl = require("./support.controller");
const { authenticate, authorize } = require("../../../middlewares/authMiddleware");

// All routes require authentication and Super Admin authorization
router.use(authenticate);
router.use(authorize("SUPER_ADMIN"));

router.get("/tickets", ctrl.getTickets);
router.get("/tickets/:ticketId", ctrl.getTicketById);
router.post("/tickets/:ticketId/messages", ctrl.sendAdminMessage);
router.patch("/tickets/:ticketId/status", ctrl.updateTicketStatus);
router.post("/tickets/start", ctrl.startChatWithCustomer);
router.get("/customers", ctrl.getRegisteredCustomers);

module.exports = router;
