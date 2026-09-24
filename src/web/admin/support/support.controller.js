const catchAsync = require("../../../utils/catchAsync");
const supportService = require("./support.service");

const getTickets = catchAsync(async (req, res) => {
  const result = await supportService.getTickets(req.query);
  res.json({ success: true, data: result.tickets, pagination: { total: result.total, page: result.page, limit: result.limit } });
});

const getTicketById = catchAsync(async (req, res) => {
  const ticket = await supportService.getTicketById(req.params.ticketId);
  res.json({ success: true, data: ticket });
});

const sendAdminMessage = catchAsync(async (req, res) => {
  const adminName = req.user?.name || "Super Admin";
  const adminId = req.user?.id || null;
  const result = await supportService.sendAdminMessage(req.params.ticketId, {
    ...req.body,
    senderName: adminName,
    adminId
  });

  try {
    const io = req.app.get("io");
    if (io) {
      io.to(`ticket:${req.params.ticketId}`).emit("support:new_message", result);
      io.to(`ticket:${req.params.ticketId}`).emit("message:new", result.message);
      io.to("admin_support").emit("support:ticket_updated", result.ticket);
    }
  } catch (err) {
    console.error("[SUPPORT SOCKET] Admin message emit failed:", err.message);
  }

  res.json({ success: true, data: result });
});

const updateTicketStatus = catchAsync(async (req, res) => {
  const ticket = await supportService.updateTicketStatus(req.params.ticketId, req.body);
  try {
    const io = req.app.get("io");
    if (io) {
      io.to(`ticket:${ticket.id}`).emit("support:status_changed", ticket);
      io.to("admin_support").emit("support:ticket_updated", ticket);
    }
  } catch (err) {
    console.error("[SUPPORT SOCKET] Status update emit failed:", err.message);
  }
  res.json({ success: true, data: ticket });
});

const startChatWithCustomer = catchAsync(async (req, res) => {
  const ticket = await supportService.startChatWithCustomer(req.body.appUserId);
  try {
    const io = req.app.get("io");
    if (io) {
      io.to("admin_support").emit("support:ticket_created", ticket);
    }
  } catch (err) {
    console.error("[SUPPORT SOCKET] Start chat emit failed:", err.message);
  }
  res.json({ success: true, data: ticket });
});

const getRegisteredCustomers = catchAsync(async (req, res) => {
  const customers = await supportService.getRegisteredCustomers(req.query.search);
  res.json({ success: true, data: customers });
});

const clearAllTickets = catchAsync(async (req, res) => {
  const result = await supportService.clearAllTickets();
  try {
    const io = req.app.get("io");
    if (io) {
      io.to("admin_support").emit("support:tickets_cleared");
    }
  } catch (err) {
    console.error("[SUPPORT SOCKET] Clear tickets emit failed:", err.message);
  }
  res.json({ success: true, message: "All support tickets and messages cleared successfully", data: result });
});

module.exports = {
  getTickets,
  getTicketById,
  sendAdminMessage,
  updateTicketStatus,
  startChatWithCustomer,
  getRegisteredCustomers,
  clearAllTickets,
};
