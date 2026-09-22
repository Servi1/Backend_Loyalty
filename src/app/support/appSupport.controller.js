const ApiError = require("../../utils/ApiError");
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

/**
 * POST /api/app/:tenantId/support/upload
 * POST /api/app/support/upload
 * Customer uploads image attachment for support chat
 */
const uploadAttachment = catchAsync(async (req, res) => {
  const file = req.file || (req.files && req.files[0]);
  if (!file) {
    throw new ApiError(400, "No support attachment image provided");
  }

  const imageUrl = `/uploads/support/${file.filename}`;

  res.status(201).json({
    success: true,
    imageUrl,
    data: {
      imageUrl,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
    },
  });
});

module.exports = {
  getThread,
  sendMessage,
  uploadAttachment,
};
