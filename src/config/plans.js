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

// Amounts are in the smallest unit: 1900 = GBP 19.00.
//
// These are deliberately plain numbers rather than environment variables:
// the price lives in ONE place, in version control. Change it here, then run
// `npm run stripe:setup` to create the new Stripe price and paste the printed
// id into PLAN_*_PRICE_ID. The ids must stay in the environment, because test
// mode and live mode have different ones.
const PLANS = [
  {
    id: "monthly",
    name: "Monthly",
    // months of access, used to work out the saving against the monthly rate
    months: 1,
    amount: 1900, // GBP 19.00
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
    amount: 9900, // GBP 99.00
    interval: "month",
    intervalCount: 6,
    priceId: process.env.PLAN_SIXMONTH_PRICE_ID || "",
    lookupKey: "adi_check_pro_sixmonth",
    blurb: "Billed twice a year",
  },
  {
    id: "yearly",
    name: "12 months",
    months: 12,
    amount: 15950, // GBP 159.00
    interval: "year",
    intervalCount: 1,
    priceId: process.env.PLAN_YEARLY_PRICE_ID || "",
    lookupKey: "adi_check_pro_yearly",
    blurb: "Best value, billed once a year",
  },
];

// The monthly plan is the yardstick every discount is measured against.
const baseline = PLANS.find((plan) => plan.months === 1);

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
    configured: Boolean(plan.priceId),
  };
}

module.exports = {
  currency,
  trialDays: num("BILLING_TRIAL_DAYS", 14),
  plans: PLANS.map(withPricing),
  getPlan: (id) => PLANS.map(withPricing).find((plan) => plan.id === id),
  // Raw definitions, for the setup script.
  definitions: PLANS,
  // Env vars that are masking a different value in this file.
  overrides,
};
