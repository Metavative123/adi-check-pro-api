// Sends a properly signed event at your running webhook, exactly the way
// Stripe does - no Stripe CLI needed.
//
//   npm run webhook:test                       a paid invoice
//   npm run webhook:test -- invoice.payment_failed
//   npm run webhook:test -- --bad-signature    proves forgeries are rejected
//   npm run webhook:test -- --customer cus_123 attach to a real customer
//
// The API must already be running. It reads STRIPE_WEBHOOK_SECRET from .env,
// so the secret here is the same one your server is verifying against.
require("dotenv").config();
const Stripe = require("stripe");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const eventType = args.find((a) => !a.startsWith("--") && a.includes(".")) ||
  "invoice.payment_succeeded";
const badSignature = args.includes("--bad-signature");
const customerId = flag("customer") || "cus_local_test";
const url =
  flag("url") ||
  `http://localhost:${process.env.PORT || 5000}/api/billing/webhook`;

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error("STRIPE_WEBHOOK_SECRET is not set in .env");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");
const now = Math.floor(Date.now() / 1000);

// Shaped like the real thing, including where the current API version puts
// the subscription id.
function invoicePayload(paid) {
  return {
    id: "in_local_" + Date.now(),
    object: "invoice",
    customer: customerId,
    currency: "gbp",
    status: paid ? "paid" : "open",
    amount_paid: paid ? 1900 : 0,
    amount_due: 1900,
    status_transitions: paid ? { paid_at: now } : {},
    hosted_invoice_url: "https://invoice.stripe.com/i/local_test",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_local_test" },
    },
    lines: {
      data: [
        {
          description: "ADI Check Pro - Monthly",
          period: { start: now, end: now + 2592000 },
          parent: { subscription_item_details: { subscription: "sub_local_test" } },
        },
      ],
    },
  };
}

function subscriptionPayload(status) {
  return {
    id: "sub_local_test",
    object: "subscription",
    customer: customerId,
    status,
    cancel_at_period_end: false,
    metadata: { planId: "monthly" },
    items: { data: [{ current_period_end: now + 2592000 }] },
  };
}

function buildEvent(type) {
  if (type.startsWith("invoice.")) {
    return { id: "evt_local", type, data: { object: invoicePayload(!type.endsWith("failed")) } };
  }
  if (type === "customer.subscription.deleted") {
    return { id: "evt_local", type, data: { object: subscriptionPayload("canceled") } };
  }
  return { id: "evt_local", type, data: { object: subscriptionPayload("active") } };
}

async function main() {
  const event = buildEvent(eventType);
  const payload = JSON.stringify(event);

  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: badSignature ? "whsec_deliberately_wrong" : secret,
  });

  console.log(`POST   ${url}`);
  console.log(`event  ${eventType}`);
  console.log(`signed ${badSignature ? "with the WRONG secret (should be rejected)" : "correctly"}`);
  console.log("");

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signature },
      body: payload,
    });
  } catch {
    console.error("Could not reach the API. Is it running?");
    process.exit(1);
  }

  const body = await res.text();
  console.log(`status ${res.status}`);
  console.log(`body   ${body}`);
  console.log("");

  if (badSignature) {
    console.log(res.status === 400 ? "OK - the forgery was rejected." : "PROBLEM - a forged event was accepted.");
    return;
  }

  if (res.status !== 200) {
    console.log("PROBLEM - check STRIPE_WEBHOOK_SECRET matches the running server, then restart it.");
    return;
  }

  const handled = body.includes('"handled":true');
  console.log(
    handled
      ? "OK - the event was accepted and acted on."
      : 'Accepted, but not acted on. If the reason is "no matching user", pass a real\n' +
        "customer id: npm run webhook:test -- --customer cus_xxx"
  );
}

main();
