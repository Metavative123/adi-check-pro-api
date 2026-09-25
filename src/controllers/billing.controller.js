const billingService = require("../services/billing.service");

async function getBilling(req, res) {
  // sync=1 asks Stripe for the current state, so development works without
  // webhook forwarding running.
  const billing = await billingService.getBilling(req.user.id, {
    sync: req.query.sync === "1" || req.query.sync === "true",
  });
  res.json({ success: true, data: { billing } });
}

// The plans on offer. Public to any signed-in user, whatever their state.
async function getPlans(req, res) {
  res.json({ success: true, data: billingService.listPlans() });
}

// Taking the free trial - no card, no Stripe.
async function chooseTrial(req, res) {
  const user = await billingService.chooseTrial(req.user.id);
  res.json({ success: true, data: { user } });
}

async function createCheckoutSession(req, res) {
  const session = await billingService.createCheckoutSession(req.user.id, {
    planId: req.body.planId,
    successUrl: req.body.successUrl,
    cancelUrl: req.body.cancelUrl,
  });
  res.json({ success: true, data: { url: session.url, plan: session.plan } });
}

// Called by the page Stripe returns the customer to. Applies the subscription
// there and then, so access is correct without waiting for a webhook.
async function confirmCheckout(req, res) {
  const result = await billingService.confirmCheckout(
    req.user.id,
    req.body.sessionId,
  );
  const billing = await billingService.getBilling(req.user.id);
  res.json({ success: true, data: { ...result, billing } });
}

// Cancelling from inside the app. Keeps whatever was paid for.
async function cancelSubscription(req, res) {
  const result = await billingService.cancelSubscription(req.user.id);
  const billing = await billingService.getBilling(req.user.id);

  res.json({ success: true, data: { ...result, billing } });
}

async function listPayments(req, res) {
  const payments = await billingService.listPayments(req.user.id, {
    limit: req.query.limit,
  });
  res.json({ success: true, data: { payments } });
}

async function createPortalSession(req, res) {
  const session = await billingService.createPortalSession(
    req.user.id,
    req.body.returnUrl,
  );
  res.json({ success: true, data: { url: session.url } });
}

// Public: Stripe calls this one, not the browser. The signature is what
// authenticates it.
async function webhook(req, res) {
  const event = billingService.constructEvent(
    req.body,
    req.headers["stripe-signature"],
  );
  const result = await billingService.handleEvent(event);

  res.json({ received: true, ...result });
}

module.exports = {
  getBilling,
  getPlans,
  chooseTrial,
  confirmCheckout,
  cancelSubscription,
  listPayments,
  createCheckoutSession,
  createPortalSession,
  webhook,
};
