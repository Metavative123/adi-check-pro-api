// Business logic lives here. Controllers stay thin, this file does the work.
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const { signToken, createResetToken, hashResetToken } = require("../utils/token");
const billingService = require("./billing.service");
const emailService = require("./email.service");
const env = require("../config/env");

const RESET_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
// One reset email a minute per account, so the form cannot flood an inbox.
const RESEND_GAP_MS = 60 * 1000;

async function register({ name, email, password }) {
  const exists = await User.findByEmail(email);
  if (exists) throw new ApiError(409, "That email is already registered");

  // No trial yet: it starts when a plan is picked and a card entered.
  const user = await User.create({
    name,
    email,
    password,
    subscription: billingService.newSubscription(),
    // The controller has checked the box was ticked.
    termsAcceptedAt: new Date(),
  });
  return { user, token: signToken(user._id) };
}

async function login({ email, password }) {
  const user = await User.findByEmail(email);
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "Invalid email or password");
  }

  return { user, token: signToken(user._id) };
}

// Emails a one-time link. The link is never returned in the response: only
// whoever can read the inbox may use it.
async function forgotPassword({ email }) {
  // Checked before the lookup, so the answer says nothing about the address.
  if (!emailService.isConfigured && env.nodeEnv === "production") {
    throw new ApiError(503, "Password reset emails are not set up yet. Please contact us.");
  }

  const user = await User.findByEmail(email);

  // Always answer the same way, so nobody can discover which emails exist.
  if (!user) return;

  const issuedAt = user.resetTokenExpires
    ? new Date(user.resetTokenExpires).getTime() - RESET_WINDOW_MS
    : 0;
  if (Date.now() - issuedAt < RESEND_GAP_MS) return;

  const { plain, hashed } = createResetToken();
  user.resetTokenHash = hashed;
  user.resetTokenExpires = new Date(Date.now() + RESET_WINDOW_MS);
  await user.save();

  const link = `${env.clientUrl}/reset-password?token=${plain}`;
  try {
    await emailService.sendPasswordReset(user, link, RESET_WINDOW_MS / 60000);
  } catch (err) {
    console.error("Password reset email failed:", err.message);
    throw new ApiError(502, "We could not send the email just now. Please try again in a few minutes.");
  }
}

async function resetPassword({ token, password }) {
  const user = await User.findByResetToken(hashResetToken(token));

  if (!user) throw new ApiError(400, "Reset link is invalid or has expired");

  await user.setPassword(password);
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
