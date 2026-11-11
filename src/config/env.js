// All environment variables are read here, nowhere else.
require("dotenv").config();

// Vercel does not set NODE_ENV for the function at run time (and a copied
// "development" value would be wrong there), so running on Vercel is always
// production: no stack traces in responses, and no pretending an email was
// sent when it was only printed to a log.
const nodeEnv = process.env.VERCEL ? "production" : process.env.NODE_ENV || "development";

const env = {
  port: process.env.PORT || 5000,
  nodeEnv,
  // Supabase: Project Settings -> Database -> Connection string.
  // POSTGRES_URL is the name Vercel's Supabase integration gives it.
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  // The website. Links in emails point here, so it must be the real address
  // in production - never taken from the request, which anyone can fake.
  clientUrl: (
    process.env.CLIENT_URL ||
    (nodeEnv === "production"
      ? "https://adi-check-pro-web.vercel.app"
      : "http://localhost:3000")
  ).replace(/\/+$/, ""),
  // Outgoing email, through the business mailbox (SMTP). Ask the mailbox
  // provider for these; port 465 means SSL, 587 means STARTTLS.
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  emailFrom: process.env.EMAIL_FROM || "ADI Check Pro <info@adicheckpro.co.uk>",
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
