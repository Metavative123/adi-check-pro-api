// Controllers only read the request and send the response.
const authService = require("../services/auth.service");
const ApiError = require("../utils/ApiError");

async function register(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    throw new ApiError(400, "Name, email and password are required");
  }

  const { user, token } = await authService.register({ name, email, password });
  res.status(201).json({ success: true, data: { user, token } });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const { user, token } = await authService.login({ email, password });
  res.json({ success: true, data: { user, token } });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const { resetToken } = await authService.forgotPassword({ email });
  res.json({
    success: true,
    message: "If that email exists, a reset link has been sent",
    // Only exposed until real emails are wired up.
    ...(resetToken ? { resetToken } : {}),
  });
}

async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password) {
    throw new ApiError(400, "Token and new password are required");
  }

  const { user, token: jwtToken } = await authService.resetPassword({ token, password });
  res.json({ success: true, data: { user, token: jwtToken } });
}

async function me(req, res) {
  res.json({ success: true, data: { user: req.user } });
}

module.exports = { register, login, forgotPassword, resetPassword, me };
