const env = require("../config/env");

// Unique constraints in db/schema.sql, named by the field the API calls them.
const UNIQUE_FIELDS = {
  users_email_key: "email",
  users_adi_badge_number_key: "adiBadgeNumber",
  tests_reference_key: "reference",
  payments_stripe_invoice_id_key: "stripeInvoiceId",
};

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

  // Friendlier messages for the common Postgres errors.
  if (err.code === "23505") {
    // unique_violation
    statusCode = 409;
    message = `${UNIQUE_FIELDS[err.constraint] || "That value"} already exists`;
  }
  if (err.code === "22P02" || err.code === "22007" || err.code === "22008") {
    // invalid text representation / invalid date
    statusCode = 400;
    message = "One of the values sent could not be read";
  }
  if (err.code === "23514") {
    // check_violation
    statusCode = 400;
    message = "One of the values sent is not allowed";
  }

  if (statusCode === 500) console.error(err);

  res.status(statusCode).json({
    success: false,
    message,
    ...(env.nodeEnv === "development" && statusCode === 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
