const catchAsync = require("../../utils/catchAsync");
const supportService = require("../../web/admin/support/support.service");

/**
 * GET /api/app/:tenantId/support/thread
 * GET /api/app/support/thread
 * Retrieve active customer chat thread & message history
 */
const getThread = catchAsync(async (req, res) => {
  const ticket = await supportService.getCustomerThread(req.user.id);
  res.json({
    success: true,
    data: ticket
  });
});

/**
 * POST /api/app/:tenantId/support/messages
 * POST /api/app/support/messages
 * Customer sends a message to support
 */
const sendMessage = catchAsync(async (req, res) => {
  const result = await supportService.sendCustomerMessage(req.user.id, req.body);

  try {
    const io = req.app.get("io");
    if (io) {
      const ticketId = result.ticket.id;
      io.to(`ticket:${ticketId}`).emit("support:new_message", result);
      io.to(`ticket:${ticketId}`).emit("message:new", result.message);
      io.to("admin_support").emit("support:ticket_updated", result.ticket);
    }
  } catch (err) {
    console.error("[APP SUPPORT SOCKET] Customer message emit failed:", err.message);
  }

  res.json({
    success: true,
    data: result
  });
});

module.exports = {
  getThread,
  sendMessage,
};
