// What an instructor is allowed to do right now. One function decides, and
// every route and the UI read the answer from here.
//
//   full      - read and write. Subscribed, or inside a live trial. A plan that
//               has been cancelled still counts as full until the period they
//               paid for runs out.
//   read_only - can see and export their own records, but change nothing.
//               A lapsed trial, an ended subscription, a failed payment.
//   revoked   - nothing at all, not even viewing. Reserved for a refund or a
//               chargeback: the money has gone back, so the service stops.
const config = require("../config/stripe");

const LEVELS = { FULL: "full", READ_ONLY: "read_only", REVOKED: "revoked" };

const MESSAGES = {
  refund: "Your payment was refunded, so access to this account has stopped.",
  dispute: "This account is locked while a payment dispute is resolved.",
  manual: "Access to this account has been withdrawn.",
  subscription_ended: "Your subscription has ended. Subscribe again to log tests.",
  trial_ended: "Your free trial has ended. Subscribe to log tests.",
  payment_failed: "Your last payment failed. Update your card to log tests again.",
};

function accessFor(user) {
  // With billing switched off nothing is gated at all.
  if (!config.enabled) {
    return { level: LEVELS.FULL, reason: "billing_disabled", canRead: true, canWrite: true };
  }

  const sub = user?.subscription || {};

  // A refund or dispute outranks everything else, including a live period.
  if (sub.accessRevoked) {
    const reason = sub.revokedReason || "refund";
    return {
      level: LEVELS.REVOKED,
      reason,
      message: MESSAGES[reason] || MESSAGES.manual,
      canRead: false,
      canWrite: false,
      revokedAt: sub.revokedAt,
    };
  }

  // Stripe keeps a cancelled subscription "active" until the paid period ends,
  // so this covers "cancelled but still paid up" without extra bookkeeping.
  //
  // The dates are checked as well as the status. Nothing in this app runs on a
  // timer: if the webhook that ends a subscription never arrives, a stale
  // "active" would otherwise mean free service for ever.
  if (sub.status === "active") {
    const now = new Date();

    // A cancellation whose date has passed: the plan is over.
    if (sub.cancelAt && sub.cancelAt <= now) {
      return {
        level: LEVELS.READ_ONLY,
        reason: "subscription_ended",
        message: MESSAGES.subscription_ended,
        canRead: true,
        canWrite: false,
      };
    }

    // The paid period ended and no renewal was recorded. The grace window
    // covers a renewal that is in flight, or a webhook running late.
    const graceMs = config.periodGraceDays * 24 * 60 * 60 * 1000;
    if (sub.currentPeriodEnd && now - new Date(sub.currentPeriodEnd) > graceMs) {
      return {
        level: LEVELS.READ_ONLY,
        reason: "period_lapsed",
        message:
          "We have not seen a renewal for this period. Open Billing to refresh, or subscribe again.",
        canRead: true,
        canWrite: false,
      };
    }

    return { level: LEVELS.FULL, reason: "subscribed", canRead: true, canWrite: true };
  }

  // A trial runs to its end date even if the instructor has said they will not
  // continue - nothing was charged, so there is nothing to cut short.
  if (sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt > new Date()) {
    return { level: LEVELS.FULL, reason: "trial", canRead: true, canWrite: true };
  }

  const reason =
    sub.status === "past_due"
      ? "payment_failed"
      : sub.status === "canceled"
        ? "subscription_ended"
        : "trial_ended";

  return {
    level: LEVELS.READ_ONLY,
    reason,
    message: MESSAGES[reason],
    canRead: true,
    canWrite: false,
  };
}

module.exports = { LEVELS, MESSAGES, accessFor };
