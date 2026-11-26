const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");

/**
 * Tries to extract tenantId, looks up the tenant, and attaches req.tenantDb.
 * Proceed peacefully without throwing error if tenant is missing or inactive.
 */
const optionalAppTenant = async (req, _res, next) => {
  try {
    const tenantId = req.params.tenantId || req.headers["x-tenant-id"] || req.query.tenantId;

    if (!tenantId) {
      req.tenantId = null;
      req.tenant = null;
      req.tenantDb = null;
      return next();
    }

    // Lookup the tenant in the main registry by either ID or Slug
    const tenant = await mainPrisma.tenant.findFirst({
      where: {
        OR: [
          { id: tenantId },
          { slug: tenantId }
        ]
      },
    });

    if (!tenant || !tenant.isActive || tenant.ordersEnabled === false) {
      req.tenantId = null;
      req.tenant = null;
      req.tenantDb = null;
      return next();
    }

    // Attach the tenant ID and the specific database client to the request
    req.tenantId = tenant.id;
    try {
      const extraRows = await mainPrisma.$queryRawUnsafe(
        'SELECT "subscriptionPaused", "loyaltyRedeemEligibleItemIds", "loyaltyRedeemEligibleItemNames" FROM "Tenant" WHERE "id" = $1 LIMIT 1',
        tenant.id
      ).catch(() => []);
      if (extraRows && extraRows.length > 0) {
        tenant.subscriptionPaused = Boolean(extraRows[0].subscriptionPaused);
        tenant.loyaltyRedeemEligibleItemIds = extraRows[0].loyaltyRedeemEligibleItemIds || null;
        tenant.loyaltyRedeemEligibleItemNames = extraRows[0].loyaltyRedeemEligibleItemNames || null;
      }
    } catch (_) {}
    req.tenant = tenant;
    req.tenantDb = getTenantClient(tenant.dbUrl);
    next();
  } catch (error) {
    req.tenantId = null;
    req.tenant = null;
    req.tenantDb = null;
    next();
  }
};

/**
 * Enforces that a valid, active tenant database context is present.
 * Applied to brand-scoped routers (menu, branches, orders).
 */
const requireAppTenant = (req, _res, next) => {
  if (!req.tenantDb) {
    return next(new ApiError(404, "Tenant not found or inactive"));
  }
  next();
};

module.exports = { optionalAppTenant, requireAppTenant };
