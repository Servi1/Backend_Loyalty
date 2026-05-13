const ApiError = require("../utils/ApiError");
const config = require("../config");

/**
 * Global error handler — catches all errors forwarded via next(err).
 */
const errorHandler = (err, _req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Prisma known errors
  if (err.code === "P2002") {
    statusCode = 409;
    message = "A record with that value already exists";
  }

  if (config.nodeEnv === "development") {
    console.error("❌ Error:", err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(config.nodeEnv === "development" && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
