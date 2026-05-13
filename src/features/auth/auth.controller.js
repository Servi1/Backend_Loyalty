const catchAsync = require("../../utils/catchAsync");
const authService = require("./auth.service");

/** POST /api/auth/otp/send */
const sendOtp = catchAsync(async (req, res) => {
  const { phone } = req.body;
  const result = await authService.sendOtp(phone);
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/otp/verify */
const verifyOtp = catchAsync(async (req, res) => {
  const { phone, code } = req.body;
  const result = await authService.verifyOtp(phone, code);
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/login */
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginWithEmail(email, password);
  res.status(200).json({ success: true, ...result });
});

/** GET /api/auth/me */
const getMe = catchAsync(async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
});

module.exports = { sendOtp, verifyOtp, login, getMe };
