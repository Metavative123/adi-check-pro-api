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

  // How long a paid period may be overdue before access lapses on its own.
  // Renewals normally advance the period by webhook within seconds; this is
  // only the fallback for when webhooks are not arriving.
  periodGraceDays: Number(process.env.BILLING_PERIOD_GRACE_DAYS || 3),

  // Days of free access a new account gets, no card required.
  trialDays: Number(process.env.BILLING_TRIAL_DAYS || 14),

  // Where Stripe sends the customer back to.
  // Stripe substitutes {CHECKOUT_SESSION_ID}. This page sits outside the
  // signed-in guard, confirms the session, then sends the user to the
  // dashboard - otherwise the guard bounces them back to the plan screen
  // before the new subscription has been applied.
  successUrl:
    process.env.BILLING_SUCCESS_URL ||
    "http://localhost:3000/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: process.env.BILLING_CANCEL_URL || "/billing?checkout=cancelled",

  // Anything sk_live_ is a real card-charging key. Handy for banners and logs.
  isLiveMode: secretKey.startsWith("sk_live_"),
  isConfigured: Boolean(secretKey),
};
