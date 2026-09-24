// One-off: creates the subscription product and price in whichever Stripe
// account STRIPE_SECRET_KEY points at, then prints the price id for .env.
// Safe to re-run: it reuses a product with the same lookup key.
require("dotenv").config();
const Stripe = require("stripe");

const LOOKUP_KEY = "adi_check_pro_monthly";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  console.log(key.startsWith("sk_live_") ? "MODE: LIVE" : "MODE: test");

  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1 });
  if (existing.data[0]) {
    console.log("Price already exists:", existing.data[0].id);
    return;
  }

  const product = await stripe.products.create({
    name: "ADI Check Pro",
    description: "Driver and Vehicle Standards tracking for approved driving instructors",
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 1900, // GBP 19.00
    currency: "gbp",
    recurring: { interval: "month" },
    lookup_key: LOOKUP_KEY,
  });

  console.log("Product:", product.id);
  console.log("Price:  ", price.id);
  console.log("");
  console.log("Add to .env:");
  console.log(`STRIPE_PRICE_ID=${price.id}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
