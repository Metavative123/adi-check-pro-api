const billingService = require("../services/billing.service");

async function getBilling(req, res) {
  // sync=1 asks Stripe for the current state, so development works without
  // webhook forwarding running.
  const billing = await billingService.getBilling(req.user.id, {
    sync: req.query.sync === "1" || req.query.sync === "true",
  });
  res.json({ success: true, data: { billing } });
}

async function createCheckoutSession(req, res) {
  const session = await billingService.createCheckoutSession(req.user.id, {
    successUrl: req.body.successUrl,
    cancelUrl: req.body.cancelUrl,
  });
  res.json({ success: true, data: { url: session.url } });
}

async function createPortalSession(req, res) {
  const session = await billingService.createPortalSession(req.user.id, req.body.returnUrl);
  res.json({ success: true, data: { url: session.url } });
}

// Public: Stripe calls this one, not the browser. The signature is what
// authenticates it.
async function webhook(req, res) {
  const event = billingService.constructEvent(req.body, req.headers["stripe-signature"]);
  const result = await billingService.handleEvent(event);
  res.json({ received: true, ...result });
}

module.exports = { getBilling, createCheckoutSession, createPortalSession, webhook };
