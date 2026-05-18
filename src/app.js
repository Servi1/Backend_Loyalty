const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { errorHandler } = require("./middlewares/errorHandler");

// ─── Feature Routes ──────────────────────────────────
const authRoutes = require("./features/auth/auth.routes");
const tenantsRoutes = require("./features/tenants/tenants.routes");
const branchesRoutes = require("./features/branches/branches.routes");
const menusRoutes = require("./features/menus/menus.routes");
const ordersRoutes = require("./features/orders/orders.routes");
const loyaltyRoutes = require("./features/loyalty/loyalty.routes");
const uploadsRoutes = require("./features/uploads/uploads.routes");

const app = express();

// ─── Global Middlewares ──────────────────────────────
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
if (config.nodeEnv === "development") app.use(morgan("dev"));

// ─── Serve uploaded files statically ─────────────────
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ─── Health Check ────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API Routes ──────────────────────────────────────
const { extractTenant } = require("./middlewares/tenantMiddleware");

// 1. Super Admin API
app.use("/api/admin/tenants", tenantsRoutes);
app.use("/api/auth", authRoutes); // auth handles both super admin and tenant logins

// 2. Tenant API (requires tenantId)
const tenantRouter = express.Router({ mergeParams: true });
tenantRouter.use(extractTenant);
tenantRouter.use("/branches", branchesRoutes);
tenantRouter.use("/menus", menusRoutes);
tenantRouter.use("/orders", ordersRoutes);
tenantRouter.use("/loyalty", loyaltyRoutes);
tenantRouter.use("/uploads", uploadsRoutes);

app.use("/api/tenant/:tenantId", tenantRouter);

// ─── 404 Fallback ────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Error Handler (must be last) ────────────────────
app.use(errorHandler);

module.exports = app;
