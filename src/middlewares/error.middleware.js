const env = require("../config/env");

// Runs when no route matched.
function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// The single place where errors turn into responses.
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Something went wrong";

  // Friendlier messages for the common Mongoose errors.
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }
  if (err.code === 11000) {
    statusCode = 409;
    message = `${Object.keys(err.keyValue).join(", ")} already exists`;
  }

  if (statusCode === 500) console.error(err);

  res.status(statusCode).json({
    success: false,
    message,
    ...(env.nodeEnv === "development" && statusCode === 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
