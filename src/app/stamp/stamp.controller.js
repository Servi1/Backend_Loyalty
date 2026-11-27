/**
 * Public Customer Stamp Controller
 */

const catchAsync = require("../../utils/catchAsync");
const stampService = require("./stamp.service");
const appleWalletService = require("../../services/appleWallet.service");

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

const redeemCoupon = catchAsync(async (req, res) => {
  const { code, customerId, branchId } = req.body;
  const tenantId = req.body.tenantId || req.params?.tenantId;
  const data = await stampService.redeemRewardCoupon({ code, customerId, tenantId, branchId });
  res.status(200).json({ success: true, data });
});

const updateCustomerName = catchAsync(async (req, res) => {
  const { customerId, name } = req.body;
  const data = await stampService.updateCustomerName({ customerId, name });
  res.status(200).json({ success: true, data });
});

const getCustomerCard = catchAsync(async (req, res) => {
  const customerId = req.query.customerId || req.user?.id;
  const tenantId = req.query.tenantId || req.params?.tenantId;
  const token = req.query.token;
  const data = await stampService.getCustomerStampCard({ customerId, tenantId, token });
  res.status(200).json({ success: true, data });
});

const getCouponDetails = catchAsync(async (req, res) => {
  const code = req.query.code || req.body.code;
  const tenantId = req.query.tenantId || req.body.tenantId;
  const data = await stampService.getCouponDetails({ code, tenantId });
  res.status(200).json({ success: true, data });
});

const downloadAppleWalletPass = catchAsync(async (req, res) => {
  const couponIdOrCode = req.params.couponId || req.query.couponId || req.query.code || req.body?.couponId;
  const { buffer, filename } = await appleWalletService.generateCouponPass(couponIdOrCode);

  res.setHeader("Content-Type", "application/vnd.apple.pkpass");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.status(200).send(buffer);
});

const downloadCustomerStampCardPass = catchAsync(async (req, res) => {
  const customerId = req.params.customerId || req.query.customerId || req.user?.id;
  const tenantId = req.params.tenantId || req.query.tenantId;
  const phone = req.query.phone;
  const token = req.query.token;

  const { buffer, filename } = await appleWalletService.generateCustomerStampPass({
    customerId,
    tenantId,
    phone,
    token,
  });

  res.setHeader("Content-Type", "application/vnd.apple.pkpass");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.status(200).send(buffer);
});

module.exports = {
  getStampProgramInfo,
  checkCustomerPhone,
  verifyOtpAndGetCard,
  getCustomerCard,
  getEligibleItems,
  claimReward,
  redeemCoupon,
  getCouponDetails,
  updateCustomerName,
  downloadAppleWalletPass,
  downloadCustomerStampCardPass,
};
