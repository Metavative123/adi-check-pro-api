// Subscriptions, on top of Stripe Checkout and the billing portal.
//
// The trial is local: a new account gets a number of free days with no card,
// recorded on the user. Paying replaces it with a real Stripe subscription,
// and every status change is mirrored back onto the user so the rest of the
// app can answer "may this person use the app?" without calling Stripe.
const Stripe = require("stripe");
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const config = require("../config/stripe");

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
  };
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

async function createCheckoutSession(userId, { successUrl, cancelUrl }) {
  requireStripe();
  if (!config.priceId) throw new ApiError(503, "No subscription price is configured");

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  if (user.subscription?.status === "active") {
    throw new ApiError(409, "You already have an active subscription");
  }

  const customerId = await getOrCreateCustomer(user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: config.priceId, quantity: 1 }],
    success_url: successUrl || config.successUrl,
    cancel_url: cancelUrl || config.cancelUrl,
    // Lets the webhook find the user even if the customer lookup ever fails.
    client_reference_id: user._id.toString(),
    subscription_data: { metadata: { userId: user._id.toString() } },
  });

  return { url: session.url, id: session.id };
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
  user.subscription.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);

  await user.save();
  return user;
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
    limit: 1,
  });

  const latest = subscriptions.data[0];
  if (!latest) return user;

  return applySubscription(user, latest);
}

async function getBilling(userId, { sync = false } = {}) {
  const user = sync ? await syncFromStripe(userId) : await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const sub = user.subscription || {};

  // With billing off, everyone has access and the UI hides the plan screens.
  if (!config.enabled) {
    return {
      enabled: false,
      status: sub.status,
      plan: "free",
      trialDaysLeft: 0,
      cancelAtPeriodEnd: false,
      hasAccess: true,
      hasBillingAccount: false,
      testMode: !config.isLiveMode,
      configured: false,
    };
  }

  return {
    enabled: true,
    status: sub.status,
    plan: sub.plan,
    trialEndsAt: sub.trialEndsAt,
    trialDaysLeft: user.trialDaysLeft,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
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
  createCheckoutSession,
  createPortalSession,
  syncFromStripe,
  getBilling,
  constructEvent,
  handleEvent,
};
