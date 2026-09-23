const catchAsync = require("../../../utils/catchAsync");
const service = require("./adminNotifications.service");

const sendBroadcast = catchAsync(async (req, res) => {
  const { title, titleEn, titleAr, body, bodyEn, bodyAr, imageUrl, targetAudience, action } = req.body;
  const sentBy = req.user ? req.user.name || req.user.email : "Super Admin";

  const result = await service.sendBroadcastNotification({
    title: titleEn || title || titleAr,
    titleEn,
    titleAr,
    body: bodyEn || body || bodyAr,
    bodyEn,
    bodyAr,
    imageUrl,
    targetAudience,
    action,
    sentBy
  });

  res.json({
    success: true,
    message: "Broadcast notification sent successfully",
    data: result
  });
});

const sendTest = catchAsync(async (req, res) => {
  const { titleEn, titleAr, bodyEn, bodyAr, phone } = req.body;
  const result = await service.sendTestNotification({
    titleEn,
    titleAr,
    bodyEn,
    bodyAr,
    phone,
    sentBy: req.user ? req.user.name || req.user.email : "Super Admin"
  });

  res.json({
    success: true,
    message: "Test notification sent successfully",
    data: result
  });
});

const getHistory = catchAsync(async (req, res) => {
  const result = await service.getBroadcastHistory();
  res.json({ success: true, data: result });
});

const deleteHistory = catchAsync(async (req, res) => {
  const { id } = req.params;
  await service.deleteBroadcastHistory(id);
  res.json({ success: true, message: "Broadcast history item deleted successfully" });
});

const getStatus = catchAsync(async (req, res) => {
  const result = await service.getFirebaseStatus();
  res.json({ success: true, data: result });
});

module.exports = {
  sendBroadcast,
  sendTest,
  getHistory,
  deleteHistory,
  getStatus
};
