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
const adminRolesRoutes = require("./src/web/admin/roles/adminRoles.routes");
const settingsRoutes = require("./src/web/admin/settings/settings.routes");
const tenantCategoriesRoutes = require("./src/web/admin/categories/categories.routes");
const globalOrderTypesRoutes = require("./src/web/admin/order-types/globalOrderTypes.routes");
const branchesRoutes = require("./src/web/tenant/branches/branches.routes");
const menusRoutes = require("./src/web/tenant/menus/menus.routes");
const ordersRoutes = require("./src/web/tenant/orders/orders.routes");
const loyaltyRoutes = require("./src/web/tenant/loyalty/loyalty.routes");
const uploadsRoutes = require("./src/web/tenant/uploads/uploads.routes");
const usersRoutes = require("./src/web/tenant/users/users.routes");
const tenantRolesRoutes = require("./src/web/tenant/roles/tenantRoles.routes");
const tablesRoutes = require("./src/web/tenant/tables/tables.routes");
const inventoryRoutes = require("./src/web/tenant/inventory/inventory.routes");
const warehousesRoutes = require("./src/web/tenant/warehouses/warehouses.routes");
const productRequestsRoutes = require("./src/web/tenant/product-requests/product-requests.routes");
const posDevicesRoutes = require("./src/web/tenant/pos-devices/pos-devices.routes");
const kdsDevicesRoutes = require("./src/web/tenant/kds-devices/kds-devices.routes");
const qrCashiersRoutes = require("./src/web/tenant/qr-cashiers/qr-cashiers.routes");
const posRoutes = require("./src/pos/pos.routes");
const kdsRoutes = require("./src/kds/kds.routes");
const discountsRoutes = require("./src/web/tenant/discounts/discounts.routes");
const couponsRoutes = require("./src/web/tenant/coupons/coupons.routes");
const customPaymentTypesRoutes = require("./src/web/tenant/custom-payment-types/customPaymentTypes.routes");
const locationGroupsRoutes = require("./src/web/tenant/location-groups/locationGroups.routes");
const customOrderTypesRoutes = require("./src/web/tenant/custom-order-types/customOrderTypes.routes");
const notificationsRoutes = require("./src/web/tenant/notifications/notifications.routes");
const zatcaRoutes = require("./src/web/tenant/zatca/zatca.routes");

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

const { extractTenant } = require("./src/middlewares/tenantMiddleware");
const { authenticatePos } = require("./src/middlewares/posMiddleware");
const { authenticateKds } = require("./src/middlewares/kdsMiddleware");

// 1. Super Admin API
app.use("/api/admin/tenants", tenantsRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/admin/roles", adminRolesRoutes);
app.use("/api/admin/settings", settingsRoutes);
app.use("/api/admin/categories", tenantCategoriesRoutes);
app.use("/api/admin/global-order-types", globalOrderTypesRoutes);
app.use("/api/auth", authRoutes); // auth handles both super admin and tenant logins
app.use("/api/pos", authenticatePos, posRoutes);
app.use("/api/kds", authenticateKds, kdsRoutes);

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
    const kdsCount = await req.tenantDb.kdsDevice.count();
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
    const { addPosCount, addTableCount, addBranchCount, addKdsCount, addCdsCount, addQrCashierCount } = req.body;
    const tenantId = req.tenantId;

    const currentTenant = await mainPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!currentTenant) return next(new ApiError(404, "Tenant not found"));

    const posInc = Number(addPosCount) || 0;
    const tableInc = Number(addTableCount) || 0;
    const branchInc = Number(addBranchCount) || 0;
    const kdsInc = Number(addKdsCount) || 0;
    const cdsInc = Number(addCdsCount) || 0;
    const qrCashierInc = Number(addQrCashierCount) || 0;

    const updated = await mainPrisma.tenant.update({
      where: { id: tenantId },
      data: {
        posQuantity: { increment: posInc },
        qrTableQuantity: { increment: tableInc },
        branchLimit: { increment: branchInc },
        kdsQuantity: { increment: kdsInc },
        cdsQuantity: { increment: cdsInc },
        qrCashierQuantity: { increment: qrCashierInc }
      }
    });

    // Record TenantSlotAddon entries so mid-month purchases sync with Super Admin Billing
    const purchases = [
      { serviceType: "pos", quantity: posInc, priceKey: "pricePos", defaultPrice: 49.0 },
      { serviceType: "qr_table", quantity: tableInc, priceKey: "priceQrTable", defaultPrice: 19.0 },
      { serviceType: "branch", quantity: branchInc, priceKey: "priceBranch", defaultPrice: 19.0 },
      { serviceType: "kds", quantity: kdsInc, priceKey: "priceKds", defaultPrice: 19.0 },
      { serviceType: "cds", quantity: cdsInc, priceKey: "priceCds", defaultPrice: 9.0 },
      { serviceType: "qr_cashier", quantity: qrCashierInc, priceKey: "priceQrCashier", defaultPrice: 9.0 }
    ];

    for (const p of purchases) {
      if (p.quantity > 0) {
        const unitPrice = currentTenant[p.priceKey] !== undefined && currentTenant[p.priceKey] !== null
          ? Number(currentTenant[p.priceKey])
          : p.defaultPrice;

        try {
          await mainPrisma.tenantSlotAddon.create({
            data: {
              tenantId,
              serviceType: p.serviceType,
              quantity: p.quantity,
              pricePerUnit: unitPrice,
              notes: `Purchased +${p.quantity} ${p.serviceType.toUpperCase()} slot(s) via Brand Market`
            }
          });
        } catch (err) {
          console.error(`Failed to record slot addon for tenant ${tenantId}:`, err.message);
        }
      }
    }

    const tableCount = await req.tenantDb.table.count();
    const posCount = await req.tenantDb.posDevice.count();
    const branchCount = await req.tenantDb.branch.count();
    const kdsCount = await req.tenantDb.kdsDevice.count();
    const qrCashierCount = await req.tenantDb.qrCashier.count();
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
        activeCdsCount: cdsCount,
        activeQrCashiersCount: qrCashierCount
      }
    });
  } catch (error) {
    next(error);
  }
});
tenantRouter.use("/branches", branchesRoutes);
tenantRouter.use("/users", usersRoutes);
tenantRouter.use("/roles", tenantRolesRoutes);
tenantRouter.use("/tables", tablesRoutes);
tenantRouter.use("/inventory", inventoryRoutes);
tenantRouter.use("/warehouses", warehousesRoutes);
tenantRouter.use("/product-requests", productRequestsRoutes);
tenantRouter.use("/pos-devices", posDevicesRoutes);
tenantRouter.use("/kds-devices", kdsDevicesRoutes);
tenantRouter.use("/qr-cashiers", qrCashiersRoutes);
tenantRouter.use("/menus", menusRoutes);
tenantRouter.use("/orders", ordersRoutes);
tenantRouter.use("/loyalty", loyaltyRoutes);
tenantRouter.use("/uploads", uploadsRoutes);
tenantRouter.use("/discounts", discountsRoutes);
tenantRouter.use("/coupons", couponsRoutes);
tenantRouter.use("/custom-payment-types", customPaymentTypesRoutes);
tenantRouter.use("/location-groups", locationGroupsRoutes);
tenantRouter.use("/custom-order-types", customOrderTypesRoutes);
tenantRouter.use("/notifications", notificationsRoutes);
tenantRouter.use("/", zatcaRoutes);

app.use("/api/tenant/:tenantId", tenantRouter);

// Public App Content Endpoints (Privacy Policy & FAQs)
const settingsService = require("./src/web/admin/settings/settings.service");

app.get("/api/app/content", async (_req, res, next) => {
  try {
    const data = await settingsService.getAppContent();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

app.get("/api/app/content/privacy-policy", async (_req, res, next) => {
  try {
    const data = await settingsService.getAppContent();
    res.json({ success: true, data: { content: data.privacyPolicy } });
  } catch (err) {
    next(err);
  }
});

app.get("/api/app/content/faq", async (_req, res, next) => {
  try {
    const data = await settingsService.getAppContent();
    res.json({ success: true, data: data.faqList });
  } catch (err) {
    next(err);
  }
});

// 3. Mobile App API
const branchCtrl = require("./src/app/branches/branches.controller");
app.get("/api/app/qr/resolve", branchCtrl.resolveQrToken);
app.post("/api/app/qr/encode", branchCtrl.encodeQrTokenEndpoint);

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

// Start background periodic order sync worker to guarantee 100% real-time order consistency
const tenantsService = require("./src/web/admin/tenants/tenants.service");
setTimeout(() => {
  tenantsService.syncAllTenantOrders().catch(err => console.error("[BACKGROUND ORDER SYNC] Initial sync warning:", err.message));
}, 5000);

setInterval(() => {
  tenantsService.syncAllTenantOrders().catch(err => console.error("[BACKGROUND ORDER SYNC] Periodic sync warning:", err.message));
}, 2 * 60 * 1000);

module.exports = app;
