const ApiError = require("../utils/ApiError");
const config = require("../config/stripe");

// Blocks everything, including reads. Only a refund or a dispute lands here,
// so the message explains that rather than offering to sell them something.
function requireAccess(req, res, next) {
  if (!config.enabled) return next();

  const access = req.user?.access;
  if (!access || access.canRead) return next();

  return next(new ApiError(403, access.message));
}

// Blocks changes but allows viewing and exporting. A lapsed trial or an ended
// subscription lands here: the instructor keeps their records, read only.
function requireWriteAccess(req, res, next) {
  if (!config.enabled) return next();

  const access = req.user?.access;
  if (!access || access.canWrite) return next();

  // 403 once access is revoked - there is nothing to buy that fixes a refund.
  // 402 otherwise, because paying does fix it.
  const status = access.level === "revoked" ? 403 : 402;
  return next(new ApiError(status, access.message));
}

// The profile (badge number and test centres) is not what the plan pays for,
// so anyone who can still read may fill it in: a new account before it has a
// plan, and a lapsed one, which would otherwise be held on the onboarding
// screen with no way through to the plan page. Only a refund or dispute
// blocks it, the same as everything else.
function requireProfileAccess(req, res, next) {
  return requireAccess(req, res, next);
}

module.exports = { requireAccess, requireWriteAccess, requireProfileAccess };
