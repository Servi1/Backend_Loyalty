const catchAsync = require("../../../utils/catchAsync");
const notificationsService = require("./notifications.service");

const remindWhatsApp = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await notificationsService.sendWhatsAppReminder(req.tenantDb, id);
  res.json({ success: true, message: "WhatsApp reminder sent successfully", result });
});

const remindEmail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await notificationsService.sendEmailReminder(req.tenantDb, id);
  res.json({ success: true, message: "Email reminder sent successfully", result });
});

module.exports = {
  remindWhatsApp,
  remindEmail,
};
