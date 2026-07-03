const jwt = require("jsonwebtoken");
const config = require("../config");
const ApiError = require("../utils/ApiError");
const mainPrisma = require("../config/prisma");
const { getTenantClient } = require("../config/tenantManager");

/**
 * POS authentication middleware that:
 * 1. Extracts the tenant ID from header (x-tenant-id) or query or params.
 * 2. Connects to the tenant database and attaches client to req.tenantDb.
 * 3. Authenticates the Bearer JWT token.
 * 4. Ensures the user role is CASHIER or BRAND_MANAGER.
 */
const authenticatePos = async (req, res, next) => {
  try {
    // 1. Tenant Extraction
    const tenantId = req.headers["x-tenant-id"] || req.params.tenantId || req.query.tenantId;
    if (!tenantId) {
      return next(new ApiError(400, "Tenant ID is required (x-tenant-id header)"));
    }

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

    req.tenantId = tenant.id;
    req.tenant = tenant;
    req.tenantDb = getTenantClient(tenant.dbUrl);

    // 2. Authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new ApiError(401, "Authentication token required"));
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    // 3. User Lookup inside Tenant DB
    const user = await req.tenantDb.user.findUnique({
      where: { id: decoded.sub },
      include: { branch: true }
    });

    if (!user) {
      return next(new ApiError(401, "Cashier user no longer exists"));
    }

    // 4. Role Authorization
    if (user.role !== "CASHIER" && user.role !== "BRAND_MANAGER") {
      return next(new ApiError(403, "Access denied. Only Cashiers can access POS endpoints."));
    }

    if (user.branch && !user.branch.isOpen && user.role !== "BRAND_MANAGER") {
      return next(new ApiError(403, "This branch is currently deactivated."));
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return next(new ApiError(401, "Invalid or expired token"));
    }
    next(new ApiError(500, "Error authenticating POS terminal"));
  }
};

module.exports = { authenticatePos };
