// The plans on offer. This is the file to edit when prices change.
//
// Each plan needs a Stripe price to charge against. Run `npm run stripe:setup`
// after changing any amount or interval - it creates the missing prices and
// prints the ids to paste back in (or set them as environment variables).
require("dotenv").config();

// Records every case where an environment variable is overriding a different
// value written in this file. Editing the number here has no effect while the
// env var is set, which is confusing enough to be worth reporting.
const overrides = [];

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(
      `${name} must be a number, got "${raw}". Check your .env file.`,
    );
    process.exit(1);
  }

  if (value !== fallback) {
    overrides.push({ name, envValue: value, codeDefault: fallback });
  }

  return value;
}

const currency = (process.env.BILLING_CURRENCY || "gbp").toLowerCase();

// Amounts are in the smallest unit: 999 = GBP 9.99.
//
// These are deliberately plain numbers rather than environment variables:
// the price lives in ONE place, in version control. Change it here, then run
// `npm run stripe:setup` to create the new Stripe price and paste the printed
// id into PLAN_*_PRICE_ID. The ids must stay in the environment, because test
// mode and live mode have different ones.
const PLANS = [
  {
    // The first FOUNDING_LIMIT members to pay. They keep this price for as
    // long as they stay subscribed; a place is used up for good once taken,
    // even if that member later cancels.
    id: "founding",
    name: "Founding member",
    founding: true,
    months: 1,
    amount: 599, // GBP 5.99
    interval: "month",
    intervalCount: 1,
    priceId: process.env.PLAN_FOUNDING_PRICE_ID || "",
    lookupKey: "adi_check_pro_founding",
    blurb: "Locked in for as long as you stay subscribed",
  },
  {
    id: "monthly",
    name: "Monthly",
    // months of access, used to work out the saving against the monthly rate
    months: 1,
    amount: 999, // GBP 9.99
    // How Stripe should bill it.
    interval: "month",
    intervalCount: 1,
    priceId: process.env.PLAN_MONTHLY_PRICE_ID || "",
    lookupKey: "adi_check_pro_monthly",
    blurb: "Rolling month, cancel any time",
  },
  {
    id: "sixmonth",
    name: "6 months",
    months: 6,
    amount: 4995, // GBP 49.95 - one month free (5 x 9.99)
    interval: "month",
    intervalCount: 6,
    priceId: process.env.PLAN_SIXMONTH_PRICE_ID || "",
    lookupKey: "adi_check_pro_sixmonth",
    blurb: "One month free, billed twice a year",
  },
  {
    id: "yearly",
    name: "12 months",
    months: 12,
    amount: 9990, // GBP 99.90 - two months free (10 x 9.99)
    interval: "year",
    intervalCount: 1,
    priceId: process.env.PLAN_YEARLY_PRICE_ID || "",
    lookupKey: "adi_check_pro_yearly",
    blurb: "Two months free, billed once a year",
  },
];

// How many founding places there are, ever.
const FOUNDING_LIMIT = 50;

// The monthly plan is the yardstick every discount is measured against.
const baseline = PLANS.find((plan) => plan.id === "monthly");

// Works out the saving rather than storing it, so changing an amount updates
// the advertised discount automatically and the two can never disagree.
function withPricing(plan) {
  const fullPrice = baseline ? baseline.amount * plan.months : plan.amount;
  const saving = Math.max(fullPrice - plan.amount, 0);
  const savingPercent =
    fullPrice > 0 ? Math.round((saving / fullPrice) * 100) : 0;

  return {
    ...plan,
    currency,
    // Per month, so plans of different lengths can be compared honestly.
    perMonth: Math.round(plan.amount / plan.months),
    fullPrice,
    saving,
    savingPercent,
    hasDiscount: savingPercent > 0,
    // The saving in whole months of the monthly price, e.g. 1 for the
    // 6-month plan. 0 when it does not come to whole months.
    freeMonths:
      baseline && plan.id !== "founding" && saving > 0 && saving % baseline.amount === 0
        ? saving / baseline.amount
        : 0,
    configured: Boolean(plan.priceId),
  };
}

module.exports = {
  currency,
  foundingLimit: FOUNDING_LIMIT,
  trialDays: num("BILLING_TRIAL_DAYS", 14),
  plans: PLANS.map(withPricing),
  getPlan: (id) => PLANS.map(withPricing).find((plan) => plan.id === id),
  // Raw definitions, for the setup script.
  definitions: PLANS,
  // Env vars that are masking a different value in this file.
  overrides,
};
