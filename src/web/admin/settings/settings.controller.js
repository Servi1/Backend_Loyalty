const catchAsync = require("../../../utils/catchAsync");
const settingsService = require("./settings.service");

const getSettings = catchAsync(async (req, res) => {
  const result = await settingsService.getSettings();
  res.json({ success: true, data: result });
});

const updateSettings = catchAsync(async (req, res) => {
  const configs = req.body.configs;
  if (!Array.isArray(configs)) {
    return res.status(400).json({ success: false, message: "configs must be an array of key-value pairs" });
  }
  const result = await settingsService.updateSettings(configs);
  res.json({ success: true, data: result });
});

const getAppContent = catchAsync(async (req, res) => {
  const hostUrl = `${req.protocol}://${req.get("host")}`;
  const result = await settingsService.getAppContent(hostUrl);
  res.json({ success: true, data: result });
});

const updateAppContent = catchAsync(async (req, res) => {
  const hostUrl = `${req.protocol}://${req.get("host")}`;
  const { privacyPolicy, faqList } = req.body;
  const result = await settingsService.updateAppContent({ privacyPolicy, faqList }, hostUrl);
  res.json({ success: true, data: result });
});

module.exports = {
  getSettings,
  updateSettings,
  getAppContent,
  updateAppContent
};
