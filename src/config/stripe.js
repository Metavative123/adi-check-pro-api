// Billing configuration. Swapping test mode for live is only a matter of
// changing these environment variables - no code changes.
require("dotenv").config();

const secretKey = process.env.STRIPE_SECRET_KEY || "";

module.exports = {
  // The master switch. While this is off, Stripe is never called and nothing
  // is paywalled - the whole app behaves as if billing did not exist.
  // Set BILLING_ENABLED=true to turn it back on.
  enabled: process.env.BILLING_ENABLED === "true",

  secretKey,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",

  // The recurring price the Upgrade button subscribes to.
  priceId: process.env.STRIPE_PRICE_ID || "",

  // Required to accept webhooks. Without it they are rejected rather than
  // trusted, because an unverified webhook can be sent by anyone.
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",

  // Days of free access a new account gets, no card required.
  trialDays: Number(process.env.BILLING_TRIAL_DAYS || 14),

  // Where Stripe sends the customer back to.
  successUrl: process.env.BILLING_SUCCESS_URL || "/billing?checkout=success",
  cancelUrl: process.env.BILLING_CANCEL_URL || "/billing?checkout=cancelled",

  // Anything sk_live_ is a real card-charging key. Handy for banners and logs.
  isLiveMode: secretKey.startsWith("sk_live_"),
  isConfigured: Boolean(secretKey),
};
