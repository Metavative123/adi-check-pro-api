const ApiError = require("../utils/ApiError");
const config = require("../config/stripe");

// Guards the paid features. The trial counts as access until it runs out.
function requireSubscription(req, res, next) {
  // Billing turned off: everything is free, nothing is blocked.
  if (!config.enabled) return next();

  if (req.user?.hasAccess) return next();

  return next(
    new ApiError(402, "Your free trial has ended. Subscribe to keep logging tests.")
  );
}

module.exports = { requireSubscription };
