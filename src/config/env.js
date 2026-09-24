// All environment variables are read here, nowhere else.
require("dotenv").config();

const env = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
  // Optional. Only needed if your machine's DNS cannot do SRV lookups.
  dnsServers: (process.env.DNS_SERVERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

// Fail early with a clear message instead of a confusing crash later.
const required = ["mongoUri", "jwtSecret"];
const missing = required.filter((key) => !env[key]);

if (missing.length) {
  const message = `Missing env variables: ${missing.join(", ")}. Set them in .env, or in the host's environment settings when deployed.`;
  console.error(message);
  // Throwing rather than exiting: on a serverless platform process.exit turns
  // into an unexplained crash, while a thrown error shows up in the logs.
  throw new Error(message);
}

module.exports = env;
