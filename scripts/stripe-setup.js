// Creates the subscription product and one price per plan in whichever Stripe
// account STRIPE_SECRET_KEY points at, then prints the ids for .env.
//
// Safe to re-run: an existing price with the same lookup key is reused. Change
// an amount in src/config/plans.js and re-run to create the new price.
require("dotenv").config();
const Stripe = require("stripe");
const plansConfig = require("../src/config/plans");

const PRODUCT_NAME = "ADI Check Pro";

function money(amount, currency) {
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function warnAboutOverrides() {
  if (plansConfig.overrides.length === 0) return;

  console.log("NOTE: these environment variables are overriding the values in");
  console.log("      src/config/plans.js, so editing that file changed nothing:");
  console.log("");
  for (const o of plansConfig.overrides) {
    console.log(
      `      ${o.name}=${o.envValue}  (plans.js says ${o.codeDefault})`
    );
  }
  console.log("");
  console.log("      Change the value in .env, or remove the line to use plans.js.");
  console.log("");
}

async function findOrCreateProduct(stripe) {
  const existing = await stripe.products.search({
    query: `name:"${PRODUCT_NAME}" AND active:"true"`,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0];

  return stripe.products.create({
    name: PRODUCT_NAME,
    description: "Driver and Vehicle Standards tracking for approved driving instructors",
  });
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  console.log(key.startsWith("sk_live_") ? "MODE: LIVE" : "MODE: test");
  console.log("");

  warnAboutOverrides();

  const product = await findOrCreateProduct(stripe);
  console.log("Product:", product.id);
  console.log("");

  const envLines = [];

  for (const plan of plansConfig.plans) {
    // A lookup key can only belong to one price, so include the amount: a
    // price cannot be edited once created, only replaced.
    const lookupKey = `${plan.lookupKey}_${plan.amount}`;

    const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    let price = found.data[0];

    if (price) {
      console.log(`${plan.name.padEnd(10)} reused  ${price.id}  ${money(plan.amount, plan.currency)}`);
    } else {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.amount,
        currency: plan.currency,
        recurring: { interval: plan.interval, interval_count: plan.intervalCount },
        lookup_key: lookupKey,
        nickname: `${PRODUCT_NAME} - ${plan.name}`,
      });
      console.log(`${plan.name.padEnd(10)} created ${price.id}  ${money(plan.amount, plan.currency)}`);
    }

    const saving = plan.hasDiscount ? `  (saves ${plan.savingPercent}%)` : "";
    console.log(`${" ".repeat(11)}${money(plan.perMonth, plan.currency)} per month${saving}`);

    envLines.push(`PLAN_${plan.id.toUpperCase()}_PRICE_ID=${price.id}`);
  }

  console.log("");
  console.log("Add these to .env:");
  for (const line of envLines) console.log(line);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
