const ApiError = require("../utils/ApiError");
const { verifyToken } = require("../utils/token");
const authService = require("../services/auth.service");

// Put `protect` on any route that needs a logged-in user.
// It reads "Authorization: Bearer <token>" and sets req.user.
async function protect(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return next(new ApiError(401, "You are not signed in"));

  try {
    const payload = verifyToken(token);
    req.user = await authService.getById(payload.id);
    next();
  } catch {
    next(new ApiError(401, "Session is invalid or has expired"));
  }
}

// Usage: router.get("/admin", protect, restrictTo("admin"), handler)
function restrictTo(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, "You do not have access to this resource"));
    }
    next();
  };
}

module.exports = { protect, restrictTo };
