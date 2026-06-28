const jwt = require("jsonwebtoken");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");
const mainPrisma = require("../../config/prisma");

/**
 * Verify JWT token from the Authorization header specifically for APP customer users.
 */
const authenticateAppUser = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiError(401, "Authentication required");
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    if (decoded.type !== "customer") {
      throw new ApiError(403, "This endpoint is for app customers only");
    }

    const customer = await mainPrisma.appUser.findUnique({ where: { id: decoded.sub } });
    if (!customer) {
      throw new ApiError(401, "Customer no longer exists");
    }

    if (customer.isDelete) {
      throw new ApiError(401, "Customer account has been deleted");
    }

    req.user = {
      ...customer,
      role: "CUSTOMER"
    };

    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, "Invalid or expired token"));
  }
};

module.exports = { authenticateAppUser };
