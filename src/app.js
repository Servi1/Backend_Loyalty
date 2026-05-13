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
app.use("/api/auth", authRoutes);
app.use("/api/tenants", tenantsRoutes);
app.use("/api/branches", branchesRoutes);
app.use("/api/menus", menusRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/uploads", uploadsRoutes);

// ─── 404 Fallback ────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Error Handler (must be last) ────────────────────
app.use(errorHandler);

module.exports = app;
