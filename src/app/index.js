/**
 * App Router — Mobile Consumer API
 *
 * All routes are scoped under: /api/app/:tenantId/
 *
 * The parent router in app.js applies:
 *   1. extractTenant middleware (resolves tenantId → tenantDb)
 *   2. mergeParams: true  (so :tenantId is accessible in sub-routers)
 *
 * Route map:
 *   POST   /auth/otp/send            → request OTP
 *   POST   /auth/otp/verify          → verify OTP → JWT
 *   GET    /auth/me                  → current user (auth required)
 *
 *   PATCH  /profile                  → update name/email/avatar (auth)
 *   DELETE /profile                  → delete account (auth)
 *
 *   GET    /menu                     → full menu (public)
 *   GET    /menu/:itemId             → item detail (public)
 *
 *   GET    /branches                 → open branches (public)
 *   GET    /branches/:branchId       → branch + tables (public)
 *
 *   POST   /orders                   → place order (auth)
 *   GET    /orders                   → my order history (auth)
 *   GET    /orders/:orderId          → order detail (auth)
 *
 *   GET    /wallet                   → wallet summary (auth)
 *   GET    /wallet/transactions      → transaction history (auth)
 */

const { Router } = require("express");

const authRoutes     = require("./auth/auth.routes");
const profileRoutes  = require("./profile/profile.routes");
const menuRoutes     = require("./menu/menu.routes");
const branchRoutes   = require("./branches/branches.routes");
const orderRoutes    = require("./orders/orders.routes");
const walletRoutes   = require("./wallet/wallet.routes");
const brandsRoutes   = require("./brands/brands.routes");
const cartRoutes     = require("./cart/cart.routes");

const router = Router({ mergeParams: true });

router.use("/auth",     authRoutes);
router.use("/profile",  profileRoutes);
router.use("/menu",     menuRoutes);
router.use("/branches", branchRoutes);
router.use("/orders",   orderRoutes);
router.use("/wallet",   walletRoutes);
router.use("/brands",   brandsRoutes);
router.use("/cart",     cartRoutes);

module.exports = router;
