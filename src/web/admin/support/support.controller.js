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
  res.json({ success: true, data: result });
});

const updateTicketStatus = catchAsync(async (req, res) => {
  const ticket = await supportService.updateTicketStatus(req.params.ticketId, req.body);
  res.json({ success: true, data: ticket });
});

const startChatWithCustomer = catchAsync(async (req, res) => {
  const ticket = await supportService.startChatWithCustomer(req.body.appUserId);
  res.json({ success: true, data: ticket });
});

const getRegisteredCustomers = catchAsync(async (req, res) => {
  const customers = await supportService.getRegisteredCustomers(req.query.search);
  res.json({ success: true, data: customers });
});

module.exports = {
  getTickets,
  getTicketById,
  sendAdminMessage,
  updateTicketStatus,
  startChatWithCustomer,
  getRegisteredCustomers,
};
