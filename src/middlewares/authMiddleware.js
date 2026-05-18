const jwt = require("jsonwebtoken");
const config = require("../config");
const ApiError = require("../utils/ApiError");
const mainPrisma = require("../config/prisma");

/**
 * Verify the JWT token from the Authorization header and attach `req.user` or `req.admin`.
 */
const authenticate = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiError(401, "Authentication required");
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    if (decoded.type === "super_admin") {
      const admin = await mainPrisma.superAdmin.findUnique({ where: { id: decoded.sub } });
      if (!admin) throw new ApiError(401, "Admin no longer exists");
      req.admin = admin;
      req.user = { id: admin.id, role: "SUPER_ADMIN" }; // standardize for authorize middleware
    } else {
      if (!req.tenantDb) {
        throw new ApiError(400, "Tenant context required for this user token");
      }
      const user = await req.tenantDb.user.findUnique({ where: { id: decoded.sub } });
      if (!user) throw new ApiError(401, "User no longer exists");
      req.user = user;
    }

    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, "Invalid or expired token"));
  }
};

/**
 * Restrict access to specific roles.
 * Usage: authorize("ADMIN", "BRAND_MANAGER")
 */
const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, "You do not have permission to perform this action"));
  }
  next();
};

module.exports = { authenticate, authorize };
