const ApiError = require("../utils/ApiError");
const mainPrisma = require("../config/prisma");
const { getTenantClient } = require("../config/tenantManager");

/**
 * Extract tenantId from request (header, params, or query), look up the tenant 
 * in the main database, and attach their specific PrismaClient to req.tenantDb.
 */
const extractTenant = async (req, _res, next) => {
  try {
    const tenantId =
      req.headers["x-tenant-id"] || req.params.tenantId || req.query.tenantId;

    console.log(`[DEBUG extractTenant] tenantId: "${tenantId}"`);

    if (!tenantId) {
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

    if (!tenant || !tenant.isActive) {
      return next(new ApiError(404, "Tenant not found or inactive"));
    }

    // Attach the tenant ID and the specific database client to the request
    req.tenantId = tenant.id;
    req.tenant = tenant;
    req.tenantDb = getTenantClient(tenant.dbUrl);
    next();
  } catch (error) {
    next(new ApiError(500, "Error connecting to tenant database"));
  }
};

module.exports = { extractTenant };
