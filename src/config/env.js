// All environment variables are read here, nowhere else.
require("dotenv").config();

const env = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  // Supabase: Project Settings -> Database -> Connection string.
  // POSTGRES_URL is the name Vercel's Supabase integration gives it.
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
};

// Fail early with a clear message instead of a confusing crash later.
const required = ["databaseUrl", "jwtSecret"];
const missing = required.filter((key) => !env[key]);

if (missing.length) {
  const message = `Missing env variables: ${missing.join(", ")}. Set them in .env, or in the host's environment settings when deployed.`;
  console.error(message);
  // Throwing rather than exiting: on a serverless platform process.exit turns
  // into an unexplained crash, while a thrown error shows up in the logs.
  throw new Error(message);
}

module.exports = env;
