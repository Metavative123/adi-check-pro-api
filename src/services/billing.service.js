// Subscriptions, on top of Stripe Checkout and the billing portal.
//
// The trial is local: a new account gets a number of free days with no card,
// recorded on the user. Paying replaces it with a real Stripe subscription,
// and every status change is mirrored back onto the user so the rest of the
// app can answer "may this person use the app?" without calling Stripe.
const Stripe = require("stripe");
const User = require("../models/user.model");
const Payment = require("../models/payment.model");
const ApiError = require("../utils/ApiError");
const config = require("../config/stripe");
const plansConfig = require("../config/plans");
const { accessFor } = require("./access");

const stripe = config.isConfigured ? new Stripe(config.secretKey) : null;

function requireStripe() {
  if (!config.enabled) throw new ApiError(503, "Billing is turned off on this server");
  if (!stripe) throw new ApiError(503, "Billing is not configured on this server");
  return stripe;
}

// Stripe's own subscription statuses map straight onto ours.
function mapStatus(stripeStatus) {
  const known = ["trialing", "active", "past_due", "canceled", "incomplete"];
  return known.includes(stripeStatus) ? stripeStatus : "none";
}

function toDate(seconds) {
  return seconds ? new Date(seconds * 1000) : undefined;
}

// Called once, when the account is created.
function startTrial() {
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + config.trialDays);

  return {
    status: "trialing",
    plan: "trial",
    trialEndsAt: endsAt,
    cancelAtPeriodEnd: false,
    // The instructor is asked to choose a trial or a plan before the dashboard.
    planSelected: false,
  };
}

// The plans on offer, with their discounts worked out. Safe to call with
// billing switched off - it just describes what would be available.
function listPlans() {
  return {
    currency: plansConfig.currency,
    trialDays: plansConfig.trialDays,
    plans: plansConfig.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      blurb: plan.blurb,
      months: plan.months,
      amount: plan.amount,
      perMonth: plan.perMonth,
      fullPrice: plan.fullPrice,
      saving: plan.saving,
      savingPercent: plan.savingPercent,
      hasDiscount: plan.hasDiscount,
      currency: plan.currency,
      configured: plan.configured,
    })),
  };
}

// Taking the free trial is a choice like any other - it just costs nothing
// and needs no card.
async function chooseTrial(userId) {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  if (user.subscription?.status === "active") {
    throw new ApiError(409, "You are already subscribed");
  }

  // Only start the clock the first time, so re-visiting the page cannot be
  // used to extend a trial.
  if (!user.subscription?.trialEndsAt) {
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + config.trialDays);
    user.subscription.trialEndsAt = endsAt;
    user.subscription.status = "trialing";
  }

  user.subscription.planSelected = true;
  user.subscription.planId = "trial";
  await user.save();

  return user;
}

// Every customer is created lazily, on the first checkout.
async function getOrCreateCustomer(user) {
  if (user.subscription?.stripeCustomerId) return user.subscription.stripeCustomerId;

  const customer = await requireStripe().customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user._id.toString() },
  });

  user.subscription.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

async function createCheckoutSession(userId, { planId, successUrl, cancelUrl }) {
  requireStripe();

  const plan = plansConfig.getPlan(planId);
  if (!plan) throw new ApiError(400, "Unknown plan");
  if (!plan.priceId) {
    throw new ApiError(503, `The ${plan.name} plan has no Stripe price configured`);
  }

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  if (user.subscription?.status === "active") {
    throw new ApiError(409, "You already have an active subscription");
  }

  const customerId = await getOrCreateCustomer(user);

  // Our stored status can lag - a payment made seconds ago may not have been
  // applied yet. Ask Stripe, so a second checkout cannot create a second
  // subscription and bill the same person twice.
  const live = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  const alreadyLive = live.data.find((s) => ["active", "trialing", "past_due"].includes(s.status));
  if (alreadyLive) {
    // Keep our copy in step, so the UI stops offering to subscribe.
    await applySubscription(user, alreadyLive);
    throw new ApiError(
      409,
      "You already have a subscription. Use Manage billing to change or cancel it."
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: successUrl || config.successUrl,
    cancel_url: cancelUrl || config.cancelUrl,
    // Lets the webhook find the user even if the customer lookup ever fails.
    client_reference_id: user._id.toString(),
    subscription_data: { metadata: { userId: user._id.toString(), planId: plan.id } },
  });

  return { url: session.url, id: session.id, plan: plan.id };
}

// The Stripe-hosted page for changing card, invoices and cancelling.
async function createPortalSession(userId, returnUrl) {
  requireStripe();

  const user = await User.findById(userId);
  if (!user?.subscription?.stripeCustomerId) {
    throw new ApiError(400, "There is no billing account to manage yet");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.subscription.stripeCustomerId,
    return_url: returnUrl || config.successUrl,
  });

  return { url: session.url };
}

// Copies a Stripe subscription onto the user.
async function applySubscription(user, subscription) {
  const item = subscription.items?.data?.[0];

  user.subscription.status = mapStatus(subscription.status);
  user.subscription.stripeSubscriptionId = subscription.id;
  user.subscription.plan = subscription.status === "canceled" ? "trial" : "pro";
  user.subscription.currentPeriodEnd =
    toDate(subscription.current_period_end) || toDate(item?.current_period_end);
  // Current Stripe API versions set `cancel_at` to a timestamp and leave
  // `cancel_at_period_end` false, so reading only the flag misses a pending
  // cancellation entirely. Both shapes are handled.
  user.subscription.cancelAt = toDate(subscription.cancel_at);
  user.subscription.cancelAtPeriodEnd = Boolean(
    subscription.cancel_at_period_end || subscription.cancel_at
  );

  // Paying counts as choosing, so the plan screen is not shown again.
  if (subscription.status === "active" || subscription.status === "trialing") {
    user.subscription.planSelected = true;
    if (subscription.metadata?.planId) user.subscription.planId = subscription.metadata.planId;
  }

  await user.save();
  return user;
}

// Writes an invoice into the payments collection. Upserted on the invoice id,
// so a webhook delivered twice updates one row rather than creating two.
async function recordInvoice(invoice, user) {
  if (!invoice?.id) return null;

  const owner =
    user || (await User.findOne({ "subscription.stripeCustomerId": invoice.customer }));
  if (!owner) return null;

  const line = invoice.lines?.data?.[0];
  const paid = invoice.status === "paid" || invoice.amount_paid > 0;

  // Current Stripe API versions moved these off the top level of the invoice.
  // Both shapes are read so the link survives an API version change either way.
  const subscriptionId =
    invoice.subscription ||
    invoice.parent?.subscription_details?.subscription ||
    line?.parent?.subscription_item_details?.subscription ||
    undefined;

  // A charge does not point back at its invoice in current API versions, so
  // the payment intent is the only link a refund can be matched on. It is only
  // present when `payments` is expanded, so fetch it if this copy lacks it.
  let paymentIntentId =
    invoice.payment_intent || invoice.payments?.data?.[0]?.payment?.payment_intent;

  if (!paymentIntentId && stripe && invoice.id) {
    try {
      const expanded = await stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
      paymentIntentId = expanded.payments?.data?.[0]?.payment?.payment_intent;
    } catch {
      // Not fatal - the payment is still recorded, just without the link.
    }
  }

  return Payment.findOneAndUpdate(
    { stripeInvoiceId: invoice.id },
    {
      instructor: owner._id,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: paymentIntentId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: invoice.customer || undefined,
      planId: owner.subscription?.planId || undefined,
      description: line?.description || invoice.description || undefined,
      amount: invoice.amount_paid || invoice.amount_due || 0,
      currency: invoice.currency,
      status: paid ? "paid" : invoice.status === "void" ? "void" : "failed",
      periodStart: toDate(line?.period?.start),
      periodEnd: toDate(line?.period?.end),
      paidAt: paid ? toDate(invoice.status_transitions?.paid_at) || new Date() : undefined,
      receiptUrl: invoice.hosted_invoice_url || undefined,
      invoiceUrl: invoice.invoice_pdf || undefined,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

// Called when Stripe sends the customer back after Checkout. Applies the
// subscription immediately rather than waiting for a webhook, so the app is
// correct the moment the instructor returns - webhooks are the safety net,
// not the only path.
async function confirmCheckout(userId, sessionId) {
  requireStripe();
  if (!sessionId) throw new ApiError(400, "A checkout session id is required");

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "invoice"],
  });

  // The session must belong to this instructor.
  if (
    session.client_reference_id &&
    session.client_reference_id !== user._id.toString()
  ) {
    throw new ApiError(403, "That checkout session belongs to another account");
  }

  if (session.payment_status !== "paid" && session.status !== "complete") {
    return { applied: false, status: session.status };
  }

  if (session.subscription) {
    await applySubscription(user, session.subscription);
  }

  if (session.invoice) await recordInvoice(session.invoice, user);

  return { applied: true, status: session.status };
}

// Payment history for one instructor, newest first.
async function listPayments(userId, { limit = 24 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);

  return Payment.find({ instructor: userId })
    .sort({ paidAt: -1, createdAt: -1 })
    .limit(safeLimit);
}

// Money has gone back, so the service stops - immediately and completely,
// whatever period was paid for. Cancelling is not the same thing: a cancelled
// plan keeps working until the paid period ends.
async function revokeAccess(user, reason, { cancelSubscription = true } = {}) {
  user.subscription.accessRevoked = true;
  user.subscription.revokedReason = reason;
  user.subscription.revokedAt = new Date();
  await user.save();

  // Leaving the subscription running would keep billing someone whose money
  // has just been returned.
  const subscriptionId = user.subscription.stripeSubscriptionId;
  if (cancelSubscription && stripe && subscriptionId) {
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (err) {
      // Already gone, most likely. Access is revoked either way.
      console.error("Could not cancel subscription after revoke:", err.message);
    }
  }

  return user;
}

// A refund arrives as a charge event. Only a FULL refund stops the service -
// a partial one is recorded but leaves access alone.
async function handleRefund(charge) {
  const fullyRefunded =
    charge.amount_refunded > 0 && charge.amount_refunded >= charge.amount;

  // charge.invoice no longer exists, so find the row by payment intent and
  // fall back to the newest paid row for that customer.
  const query = charge.payment_intent
    ? { stripePaymentIntentId: charge.payment_intent }
    : { stripeCustomerId: charge.customer, status: "paid" };

  const updated = await Payment.findOneAndUpdate(
    query,
    { status: fullyRefunded ? "refunded" : "paid" },
    { sort: { paidAt: -1 } }
  );

  if (!updated) {
    console.error("Refund could not be matched to a stored payment:", charge.id);
  }

  if (!fullyRefunded) return { handled: true, revoked: false, reason: "partial refund" };

  const user = await User.findOne({ "subscription.stripeCustomerId": charge.customer });
  if (!user) return { handled: false, reason: "no matching user" };

  await revokeAccess(user, "refund");
  return { handled: true, revoked: true, reason: "refund" };
}

// A chargeback is money clawed back by the bank - treated the same way.
async function handleDispute(dispute) {
  const user = await User.findOne({ "subscription.stripeCustomerId": dispute.customer });
  if (!user) return { handled: false, reason: "no matching user" };

  await revokeAccess(user, "dispute");
  return { handled: true, revoked: true, reason: "dispute" };
}

// Cancelling. A paid plan keeps running to the end of the period already paid
// for - Stripe handles that, and access follows. A trial has nothing to run
// down, so it simply keeps its remaining days and will not convert.
async function cancelSubscription(userId) {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const sub = user.subscription || {};

  if (sub.status === "active" && sub.stripeSubscriptionId) {
    requireStripe();
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await applySubscription(user, updated);

    return {
      cancelled: true,
      keepsAccessUntil:
        user.subscription.cancelAt || user.subscription.currentPeriodEnd,
      message: "Your plan will not renew. You keep full access until it ends.",
    };
  }

  if (sub.status === "trialing") {
    user.subscription.trialCancelled = true;
    await user.save();

    return {
      cancelled: true,
      keepsAccessUntil: sub.trialEndsAt,
      message: "Your trial will not convert. You keep it until it ends.",
    };
  }

  throw new ApiError(400, "There is nothing to cancel");
}

// Pulls the current state from Stripe. Used when the billing page loads, so
// development works without webhook forwarding set up.
async function syncFromStripe(userId) {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const customerId = user.subscription?.stripeCustomerId;
  if (!config.enabled || !stripe || !customerId) return user;

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  if (subscriptions.data.length === 0) return user;

  // Prefer a live subscription over a cancelled one. Taking simply the newest
  // would show "cancelled" to someone who still has one running.
  const live = subscriptions.data.find((s) =>
    ["active", "trialing", "past_due"].includes(s.status)
  );

  return applySubscription(user, live || subscriptions.data[0]);
}

async function getBilling(userId, { sync = false } = {}) {
  const user = sync ? await syncFromStripe(userId) : await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const sub = user.subscription || {};

  // With billing off, everyone has access and the UI hides the plan screens.
  if (!config.enabled) {
    return {
      enabled: false,
      ...listPlans(),
      planSelected: true,
      planId: null,
      needsPlanChoice: false,
      status: sub.status,
      plan: "free",
      trialDaysLeft: 0,
      cancelAtPeriodEnd: false,
      access: accessFor(user),
      trialCancelled: false,
      hasAccess: true,
      hasBillingAccount: false,
      testMode: !config.isLiveMode,
      configured: false,
    };
  }

  return {
    enabled: true,
    ...listPlans(),
    planSelected: Boolean(sub.planSelected),
    planId: sub.planId || null,
    needsPlanChoice: user.needsPlanChoice,
    status: sub.status,
    // full / read_only / revoked, and why.
    access: user.access,
    trialCancelled: Boolean(sub.trialCancelled),
    plan: sub.plan,
    trialEndsAt: sub.trialEndsAt,
    trialDaysLeft: user.trialDaysLeft,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
    // The day access actually ends, whether that is the period end or a
    // custom date the cancellation was scheduled for.
    accessEndsAt: sub.cancelAt || sub.currentPeriodEnd,
    hasAccess: user.hasAccess,
    hasBillingAccount: Boolean(sub.stripeCustomerId),
    // Lets the UI warn that these are not real charges.
    testMode: !config.isLiveMode,
    configured: config.isConfigured && Boolean(config.priceId),
  };
}

// Webhooks are the source of truth in production: they arrive even when
// nobody has the app open.
function constructEvent(rawBody, signature) {
  requireStripe();
  if (!config.webhookSecret) {
    throw new ApiError(503, "Webhook secret is not configured");
  }

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch {
    // An unverifiable payload could have come from anyone.
    throw new ApiError(400, "Webhook signature verification failed");
  }
}

async function handleEvent(event) {
  if (!config.enabled) return { handled: false, reason: "billing disabled" };

  // Money coming back stops the service at once.
  if (event.type === "charge.refunded" || event.type === "refund.created") {
    const charge = event.data.object.charge
      ? await requireStripe().charges.retrieve(event.data.object.charge)
      : event.data.object;
    return { type: event.type, ...(await handleRefund(charge)) };
  }

  if (event.type === "charge.dispute.created") {
    return { type: event.type, ...(await handleDispute(event.data.object)) };
  }

  // Invoices are the money; subscriptions are the access. Both are handled.
  const INVOICE_EVENTS = [
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
  ];

  if (INVOICE_EVENTS.includes(event.type)) {
    const payment = await recordInvoice(event.data.object);
    return {
      handled: Boolean(payment),
      type: event.type,
      ...(payment ? { paymentId: payment._id.toString() } : { reason: "no matching user" }),
    };
  }

  const relevant = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ];
  if (!relevant.includes(event.type)) return { handled: false, type: event.type };

  let subscriptionId;
  let customerId;

  if (event.type === "checkout.session.completed") {
    subscriptionId = event.data.object.subscription;
    customerId = event.data.object.customer;
  } else {
    subscriptionId = event.data.object.id;
    customerId = event.data.object.customer;
  }

  const user = await User.findOne({ "subscription.stripeCustomerId": customerId });
  if (!user) return { handled: false, type: event.type, reason: "no matching user" };

  const subscription =
    event.type === "checkout.session.completed"
      ? await requireStripe().subscriptions.retrieve(subscriptionId)
      : event.data.object;

  await applySubscription(user, subscription);
  return { handled: true, type: event.type, status: user.subscription.status };
}

module.exports = {
  startTrial,
  listPlans,
  chooseTrial,
  confirmCheckout,
  cancelSubscription,
  revokeAccess,
  handleRefund,
  handleDispute,
  listPayments,
  recordInvoice,
  createCheckoutSession,
  createPortalSession,
  syncFromStripe,
  getBilling,
  constructEvent,
  handleEvent,
};
