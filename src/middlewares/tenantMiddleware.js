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
      req.params.tenantId || req.headers["x-tenant-id"] || req.query.tenantId;

    console.log(`[DEBUG extractTenant] tenantId: "${tenantId}"`);

    if (!tenantId || tenantId === "all" || tenantId === "null" || tenantId === "undefined") {
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

    if (!tenant) {
      return next(new ApiError(404, "Tenant not found"));
    }

    // Safely hydrate subscriptionPaused via raw SQL in case Prisma client predates schema patch
    let subscriptionPaused = Boolean(tenant.subscriptionPaused);
    try {
      const pauseRows = await mainPrisma.$queryRawUnsafe(
        'SELECT "subscriptionPaused" FROM "Tenant" WHERE "id" = $1 LIMIT 1',
        tenant.id
      );
      if (Array.isArray(pauseRows) && pauseRows[0] && pauseRows[0].subscriptionPaused !== undefined) {
        subscriptionPaused = Boolean(pauseRows[0].subscriptionPaused);
      }
    } catch {
      // Ignore if column doesn't exist yet
    }
    tenant.subscriptionPaused = subscriptionPaused;

    // Account Status check (allow Super Admin routes even if tenant is inactive)
    const isSuperAdmin = Boolean(
      req.admin ||
      (req.user?.role &&
        (String(req.user.role).toUpperCase() === "SUPER_ADMIN" ||
         String(req.user.role).startsWith("admin-role-")))
    );
    if (!tenant.isActive && !isSuperAdmin) {
      return next(new ApiError(403, "Account inactive. Your brand account has been deactivated by administration. Please contact support."));
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
