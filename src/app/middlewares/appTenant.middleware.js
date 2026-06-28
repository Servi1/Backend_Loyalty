const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");

/**
 * Extract tenantId from route path parameter (e.g., /api/app/:tenantId), look up the tenant 
 * in the main database, and attach their specific PrismaClient to req.tenantDb.
 */
const extractAppTenant = async (req, _res, next) => {
  const isGlobalRoute =
    req.path.includes("/profile") ||
    req.path.includes("/wallet") ||
    req.path.includes("/brands") ||
    req.path.includes("/cart") ||
    req.path.includes("/auth");

  try {
    const tenantId = req.params.tenantId || req.headers["x-tenant-id"] || req.query.tenantId;

    if (!tenantId) {
      if (isGlobalRoute) {
        req.tenantId = null;
        req.tenant = null;
        req.tenantDb = null;
        return next();
      }
      return next(new ApiError(400, "Tenant ID is required"));
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

    if (!tenant || !tenant.isActive) {
      if (isGlobalRoute) {
        req.tenantId = null;
        req.tenant = null;
        req.tenantDb = null;
        return next();
      }
      return next(new ApiError(404, "Tenant not found or inactive"));
    }

    // Attach the tenant ID and the specific database client to the request
    req.tenantId = tenant.id;
    req.tenant = tenant;
    req.tenantDb = getTenantClient(tenant.dbUrl);
    next();
  } catch (error) {
    if (isGlobalRoute) {
      req.tenantId = null;
      req.tenant = null;
      req.tenantDb = null;
      return next();
    }
    next(new ApiError(500, "Error connecting to tenant database"));
  }
};

module.exports = { extractAppTenant };
