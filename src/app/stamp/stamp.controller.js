/**
 * Public Customer Stamp Controller
 */

const catchAsync = require("../../utils/catchAsync");
const stampService = require("./stamp.service");

const getStampProgramInfo = catchAsync(async (req, res) => {
  const token = req.query.token || req.body?.token;
  const tenantId = req.query.tenantId || req.params?.tenantId;

  const data = await stampService.resolveStampProgram({ token, tenantId });
  res.status(200).json({ success: true, data });
});

const checkCustomerPhone = catchAsync(async (req, res) => {
  const { phone } = req.body;
  const data = await stampService.checkPhoneAndSendOtp(phone);
  res.status(200).json({ success: true, data });
});

const verifyOtpAndGetCard = catchAsync(async (req, res) => {
  const { phone, code, name, token, tenantId } = req.body;
  const data = await stampService.verifyOtpAndGetStampCard({
    phone,
    code,
    name,
    token,
    tenantId: tenantId || req.params?.tenantId,
  });
  res.status(200).json({ success: true, data });
});

const getEligibleItems = catchAsync(async (req, res) => {
  const customerId = req.query.customerId || req.user?.id;
  const tenantId = req.query.tenantId || req.params?.tenantId;
  const data = await stampService.getEligibleItemsHistory({ customerId, tenantId });
  res.status(200).json({ success: true, data });
});

const claimReward = catchAsync(async (req, res) => {
  const customerId = req.body.customerId || req.user?.id;
  const tenantId = req.body.tenantId || req.params?.tenantId;
  const { menuItemId } = req.body;
  const data = await stampService.claimRewardCoupon({ customerId, tenantId, menuItemId });
  res.status(200).json({ success: true, data });
});

const updateCustomerName = catchAsync(async (req, res) => {
  const { customerId, name } = req.body;
  const data = await stampService.updateCustomerName({ customerId, name });
  res.status(200).json({ success: true, data });
});

module.exports = {
  getStampProgramInfo,
  checkCustomerPhone,
  verifyOtpAndGetCard,
  getEligibleItems,
  claimReward,
  updateCustomerName,
};
