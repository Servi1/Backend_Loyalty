const ApiError = require("../utils/ApiError");

/**
 * Extract tenantId from request (header, params, or query) and attach to req.
 * This ensures brand data isolation in multi-tenant queries.
 */
const extractTenant = (req, _res, next) => {
  const tenantId =
    req.headers["x-tenant-id"] || req.params.tenantId || req.query.tenantId;

  if (!tenantId) {
    return next(new ApiError(400, "Tenant ID is required"));
  }

  req.tenantId = tenantId;
  next();
};

module.exports = { extractTenant };
