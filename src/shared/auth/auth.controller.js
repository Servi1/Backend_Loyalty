const catchAsync = require("../../utils/catchAsync");
const authService = require("./auth.service");

/** POST /api/auth/otp/send */
const sendOtp = catchAsync(async (req, res) => {
  const { phone } = req.body;
  const result = await authService.sendOtp(req.tenantDb, phone);
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/otp/verify */
const verifyOtp = catchAsync(async (req, res) => {
  const { phone, code } = req.body;
  const result = await authService.verifyOtp(req.tenantDb, phone, code, req.tenantId);
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/login */
const login = catchAsync(async (req, res) => {
  const { email, password, bypassOtp } = req.body;
  const result = await authService.loginWithEmail(
    req.tenantDb,
    email,
    password,
    bypassOtp === true || bypassOtp === "true",
    req.tenant
  );
  res.status(200).json({ success: true, ...result, tenant: req.tenant });
});

/** POST /api/auth/super-admin/login */
const superAdminLogin = catchAsync(async (req, res) => {
  const { email, password, bypassOtp } = req.body;
  const result = await authService.superAdminLogin(
    email,
    password,
    bypassOtp === true || bypassOtp === "true"
  );
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/kds/login */
const kdsLogin = catchAsync(async (req, res) => {
  const { deviceKey } = req.body;
  const result = await authService.kdsLogin(req.tenantDb, deviceKey, req.tenant);
  res.status(200).json({ success: true, ...result, tenant: req.tenant });
});

/** POST /api/auth/kds/logout */
const kdsLogout = catchAsync(async (req, res) => {
  const result = await authService.kdsLogout(req.tenantDb, req.body || {});
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/pos/logout */
const posLogout = catchAsync(async (req, res) => {
  const result = await authService.posLogout(req.tenantDb, req.body || {});
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/logout */
const logout = catchAsync(async (req, res) => {
  const result = await authService.deviceLogout(req.tenantDb, req.body || {});
  res.status(200).json({ success: true, ...result });
});

/** GET /api/auth/me */
const getMe = catchAsync(async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
});


/** POST /api/auth/forgot-password */
const forgotPassword = catchAsync(async (req, res) => {
  const { email, tenantId, companyNo } = req.body;
  const origin = req.get("origin") || req.get("referer");
  const result = await authService.requestPasswordReset({
    email,
    tenantId: tenantId || companyNo || req.headers["x-tenant-id"],
    origin,
  });
  res.status(200).json(result);
});

/** POST /api/auth/verify-reset-token */
const verifyResetToken = catchAsync(async (req, res) => {
  const { token } = req.body;
  const result = await authService.verifyResetToken(token);
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/reset-password */
const resetPassword = catchAsync(async (req, res) => {
  const { token, newPassword } = req.body;
  const result = await authService.resetPassword({ token, newPassword });
  res.status(200).json(result);
});


/** POST /api/auth/verify-login-otp */
const verifyLoginOtp = catchAsync(async (req, res) => {
  const { tempToken, code } = req.body;
  const result = await authService.verifyLoginOtp({ tempToken, code });
  res.status(200).json({ success: true, ...result });
});

/** POST /api/auth/resend-login-otp */
const resendLoginOtp = catchAsync(async (req, res) => {
  const { tempToken } = req.body;
  const result = await authService.resendLoginOtp({ tempToken });
  res.status(200).json({ success: true, ...result });
});

module.exports = {
  sendOtp,
  verifyOtp,
  login,
  superAdminLogin,
  kdsLogin,
  kdsLogout,
  posLogout,
  logout,
  getMe,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  verifyLoginOtp,
  resendLoginOtp,
};
