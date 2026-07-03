const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const config = require("./src/config");
const { errorHandler } = require("./src/middlewares/errorHandler");

// ─── Feature Routes ──────────────────────────────────
const authRoutes = require("./src/shared/auth/auth.routes");
const tenantsRoutes = require("./src/web/admin/tenants/tenants.routes");
const adminUsersRoutes = require("./src/web/admin/users/adminUsers.routes");
const settingsRoutes = require("./src/web/admin/settings/settings.routes");
const branchesRoutes = require("./src/web/tenant/branches/branches.routes");
const menusRoutes = require("./src/web/tenant/menus/menus.routes");
const ordersRoutes = require("./src/web/tenant/orders/orders.routes");
const loyaltyRoutes = require("./src/web/tenant/loyalty/loyalty.routes");
const uploadsRoutes = require("./src/web/tenant/uploads/uploads.routes");
const usersRoutes = require("./src/web/tenant/users/users.routes");
const tablesRoutes = require("./src/web/tenant/tables/tables.routes");
const inventoryRoutes = require("./src/web/tenant/inventory/inventory.routes");
const posDevicesRoutes = require("./src/web/tenant/pos-devices/pos-devices.routes");
const qrCashiersRoutes = require("./src/web/tenant/qr-cashiers/qr-cashiers.routes");
const posRoutes = require("./src/pos/pos.routes");

// ─── Mobile App Routes ────────────────────────────────
// ─── Mobile App Routes ────────────────────────────────
const appRouter = require("./src/app/index");

const app = express();

// ─── Global Middlewares ──────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
if (config.nodeEnv === "development") app.use(morgan("dev"));

// ─── Serve uploaded files statically ─────────────────
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── Health Check ────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API Routes ──────────────────────────────────────
const { extractTenant } = require("./src/middlewares/tenantMiddleware");
const { authenticatePos } = require("./src/middlewares/posMiddleware");

// 1. Super Admin API
app.use("/api/admin/tenants", tenantsRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/admin/settings", settingsRoutes);
app.use("/api/auth", authRoutes); // auth handles both super admin and tenant logins
app.use("/api/pos", authenticatePos, posRoutes);

const mainPrisma = require("./src/config/prisma");

const ApiError = require("./src/utils/ApiError");

// 2. Tenant API (requires tenantId)
const tenantRouter = express.Router({ mergeParams: true });
tenantRouter.use(extractTenant);
tenantRouter.get("/info", async (req, res, next) => {
  try {
    const tableCount = await req.tenantDb.table.count();
    const posCount = await req.tenantDb.posDevice.count();
    const branchCount = await req.tenantDb.branch.count();
    const kdsCount = await req.tenantDb.user.count({ where: { role: "KITCHEN" } });
    const qrCashierCount = await req.tenantDb.qrCashier.count();
    const cdsCount = 0; // CDS doesn't map to a specific database entity yet

    const marketSetting = await mainPrisma.systemSetting.findUnique({
      where: { key: "marketEnabled" }
    });
    const globalMarketEnabled = marketSetting ? marketSetting.value !== "false" : true;

    res.json({
      success: true,
      data: {
        ...req.tenant,
        marketEnabled: globalMarketEnabled,
        activeTablesCount: tableCount,
        activePosCount: posCount,
        activeBranchesCount: branchCount,
        activeKdsCount: kdsCount,
        activeCdsCount: cdsCount,
        activeQrCashiersCount: qrCashierCount
      }
    });
  } catch (err) {
    next(err);
  }
});
tenantRouter.post("/market/buy", async (req, res, next) => {
  try {
    const marketSetting = await mainPrisma.systemSetting.findUnique({
      where: { key: "marketEnabled" }
    });
    const globalMarketEnabled = marketSetting ? marketSetting.value !== "false" : true;
    if (globalMarketEnabled === false) {
      return next(new ApiError(403, "Market purchases are deactivated globally. Please contact system support."));
    }
    const { addPosCount, addTableCount, addBranchCount, addKdsCount, addCdsCount } = req.body;
    const tenantId = req.tenantId;

    const updated = await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        posQuantity: { increment: Number(addPosCount) || 0 },
        qrTableQuantity: { increment: Number(addTableCount) || 0 },
        branchLimit: { increment: Number(addBranchCount) || 0 },
        kdsQuantity: { increment: Number(addKdsCount) || 0 },
        cdsQuantity: { increment: Number(addCdsCount) || 0 }
      }
    });

    const tableCount = await req.tenantDb.table.count();
    const posCount = await req.tenantDb.posDevice.count();
    const branchCount = await req.tenantDb.branch.count();
    const kdsCount = await req.tenantDb.user.count({ where: { role: "KITCHEN" } });
    const cdsCount = 0;

    res.json({
      success: true,
      data: {
        ...updated,
        marketEnabled: globalMarketEnabled,
        activeTablesCount: tableCount,
        activePosCount: posCount,
        activeBranchesCount: branchCount,
        activeKdsCount: kdsCount,
        activeCdsCount: cdsCount
      }
    });
  } catch (error) {
    next(error);
  }
});
tenantRouter.use("/branches", branchesRoutes);
tenantRouter.use("/users", usersRoutes);
tenantRouter.use("/tables", tablesRoutes);
tenantRouter.use("/inventory", inventoryRoutes);
tenantRouter.use("/pos-devices", posDevicesRoutes);
tenantRouter.use("/qr-cashiers", qrCashiersRoutes);
tenantRouter.use("/menus", menusRoutes);
tenantRouter.use("/orders", ordersRoutes);
tenantRouter.use("/loyalty", loyaltyRoutes);
tenantRouter.use("/uploads", uploadsRoutes);

app.use("/api/tenant/:tenantId", tenantRouter);

// 3. Mobile App API
// Global app auth router (tenant-independent)
const globalAuthRouter = require("./src/app/auth/globalAuth.routes");
app.use("/api/app/auth", globalAuthRouter);

const { optionalAppTenant } = require("./src/app/middlewares/appTenant.middleware");

// Global app router for tenant-independent requests (e.g. wallet, profile, brands, cart)
app.use("/api/app", optionalAppTenant, appRouter);

// Separate router so app endpoints never collide with dashboard routes.
const appTenantRouter = express.Router({ mergeParams: true });
appTenantRouter.use(optionalAppTenant);
appTenantRouter.use("/", appRouter);

app.use("/api/app/:tenantId", appTenantRouter);

// ─── 404 Fallback ────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Error Handler (must be last) ────────────────────
app.use(errorHandler);

module.exports = app;
