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
  console.error(`Missing env variables: ${missing.join(", ")}. Check your .env file.`);
  process.exit(1);
}

module.exports = env;
