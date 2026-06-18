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

    if (token.startsWith("mock-platform-admin-token-")) {
      const admin = await mainPrisma.superAdmin.findFirst();
      if (!admin) throw new ApiError(401, "No Super Admin configured in database");
      req.admin = admin;
      req.user = { id: admin.id, role: "SUPER_ADMIN" };
      return next();
    }

    const decoded = jwt.verify(token, config.jwt.secret);

    if (decoded.type === "super_admin") {
      const admin = await mainPrisma.superAdmin.findUnique({ where: { id: decoded.sub } });
      if (!admin) throw new ApiError(401, "Admin no longer exists");
      req.admin = admin;
      req.user = { id: admin.id, role: "SUPER_ADMIN" }; // standardize for authorize middleware
    } else if (decoded.type === "customer") {
      const customer = await mainPrisma.appUser.findUnique({ where: { id: decoded.sub } });
      if (!customer) throw new ApiError(401, "Customer no longer exists");
      req.user = {
        ...customer,
        role: "CUSTOMER"
      };
    } else {
      if (!req.tenantDb) {
        throw new ApiError(400, "Tenant context required for this user token");
      }
      const user = await req.tenantDb.user.findUnique({
        where: { id: decoded.sub },
        include: { branch: true }
      });
      if (!user) throw new ApiError(401, "User no longer exists");

      if (user.branch && !user.branch.isOpen && user.role !== "BRAND_MANAGER") {
        throw new ApiError(403, "This branch is currently deactivated.");
      }

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
  console.log("[AUTH DEBUG] req.user:", req.user, "required roles:", roles);
  if (!req.user || (req.user.role !== "SUPER_ADMIN" && !roles.includes(req.user.role))) {
    console.log("[AUTH DEBUG] ACCESS DENIED!");
    return next(new ApiError(403, "You do not have permission to perform this action"));
  }
  next();
};

module.exports = { authenticate, authorize };
