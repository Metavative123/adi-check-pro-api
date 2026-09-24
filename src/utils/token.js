const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");

function signToken(userId) {
  return jwt.sign({ id: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

// Password reset: the user gets the plain token by email,
// the database only stores its hash.
function createResetToken() {
  const plain = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(plain).digest("hex");
  return { plain, hashed };
}

function hashResetToken(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

module.exports = { signToken, verifyToken, createResetToken, hashResetToken };
