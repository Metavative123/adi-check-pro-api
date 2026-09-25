// Checks that each PLAN_*_PRICE_ID in the environment really charges the
// amount configured in src/config/plans.js.
//
//   npm run stripe:check
//
// This catches the one dangerous mistake in the pricing workflow: changing an
// amount, running stripe:setup, and forgetting to paste the new price id back.
// The app would then advertise the new price and charge the old one.
require("dotenv").config();
const Stripe = require("stripe");
const plansConfig = require("../src/config/plans");

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

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  const live = key.startsWith("sk_live_");
  console.log(live ? "MODE: LIVE" : "MODE: test");
  console.log("");

  warnAboutOverrides();

  let problems = 0;

  for (const plan of plansConfig.plans) {
    const label = plan.name.padEnd(10);

    if (!plan.priceId) {
      console.log(`${label} NO PRICE ID SET  - run: npm run stripe:setup`);
      problems += 1;
      continue;
    }

    let price;
    try {
      price = await stripe.prices.retrieve(plan.priceId);
    } catch (err) {
      console.log(`${label} price not found in this account: ${plan.priceId}`);
      console.log(`${" ".repeat(11)}${err.message}`);
      problems += 1;
      continue;
    }

    const issues = [];

    if (price.unit_amount !== plan.amount) {
      issues.push(
        `amount: app says ${money(plan.amount, plan.currency)}, Stripe charges ${money(price.unit_amount, price.currency)}`
      );
    }
    if (price.currency !== plan.currency) {
      issues.push(`currency: app says ${plan.currency}, Stripe uses ${price.currency}`);
    }
    if (
      price.recurring?.interval !== plan.interval ||
      price.recurring?.interval_count !== plan.intervalCount
    ) {
      issues.push(
        `interval: app says every ${plan.intervalCount} ${plan.interval}(s), ` +
          `Stripe bills every ${price.recurring?.interval_count} ${price.recurring?.interval}(s)`
      );
    }
    if (price.active === false) {
      issues.push("this price is ARCHIVED in Stripe and cannot be used");
    }
    if (price.livemode !== live) {
      issues.push(
        `mode: this is a ${price.livemode ? "LIVE" : "test"} price but the key is ${live ? "LIVE" : "test"}`
      );
    }

    if (issues.length === 0) {
      console.log(`${label} OK       ${money(plan.amount, plan.currency)}  ${plan.priceId}`);
    } else {
      problems += issues.length;
      console.log(`${label} MISMATCH ${plan.priceId}`);
      for (const issue of issues) console.log(`${" ".repeat(11)}${issue}`);
    }
  }

  console.log("");
  if (problems === 0) {
    console.log("Every plan matches its Stripe price.");
    return;
  }

  console.log(`${problems} problem(s) found.`);
  console.log("Fix: npm run stripe:setup, then paste the printed ids into .env.");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
