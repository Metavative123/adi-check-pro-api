// Business logic lives here. Controllers stay thin, this file does the work.
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const { signToken, createResetToken, hashResetToken } = require("../utils/token");
const billingService = require("./billing.service");

const RESET_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function register({ name, email, password }) {
  const exists = await User.findOne({ email });
  if (exists) throw new ApiError(409, "That email is already registered");

  // Free trial starts the moment the account is made - no card needed.
  const user = await User.create({
    name,
    email,
    password,
    subscription: billingService.startTrial(),
  });
  return { user, token: signToken(user._id) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "Invalid email or password");
  }

  return { user, token: signToken(user._id) };
}

async function forgotPassword({ email }) {
  const user = await User.findOne({ email });

  // Always answer the same way, so nobody can discover which emails exist.
  if (!user) return { resetToken: null };

  const { plain, hashed } = createResetToken();
  user.resetTokenHash = hashed;
  user.resetTokenExpires = new Date(Date.now() + RESET_WINDOW_MS);
  await user.save();

  // TODO: email the link instead of returning it, e.g.
  // `${env.clientUrl}/reset-password?token=${plain}`
  return { resetToken: plain };
}

async function resetPassword({ token, password }) {
  const user = await User.findOne({
    resetTokenHash: hashResetToken(token),
    resetTokenExpires: { $gt: new Date() },
  }).select("+resetTokenHash +resetTokenExpires");

  if (!user) throw new ApiError(400, "Reset link is invalid or has expired");

  user.password = password;
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();

  return { user, token: signToken(user._id) };
}

async function getById(id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, "User not found");
  return user;
}

module.exports = { register, login, forgotPassword, resetPassword, getById };
