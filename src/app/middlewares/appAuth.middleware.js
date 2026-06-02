/**
 * App-layer middleware helpers.
 *
 * requireCustomer — ensures the authenticated user is a CUSTOMER (not staff).
 *                   Must be used after the shared `authenticate` middleware.
 */

const ApiError = require("../../utils/ApiError");

/**
 * Restrict access to CUSTOMER-role users only.
 * Prevents staff tokens from accessing customer-only app endpoints.
 */
const requireCustomer = (req, _res, next) => {
  if (!req.user || req.user.role !== "CUSTOMER") {
    return next(new ApiError(403, "This endpoint is for app customers only"));
  }
  next();
};

module.exports = { requireCustomer };
