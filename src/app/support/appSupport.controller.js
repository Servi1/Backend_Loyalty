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
  res.json({
    success: true,
    data: result
  });
});

module.exports = {
  getThread,
  sendMessage,
};
