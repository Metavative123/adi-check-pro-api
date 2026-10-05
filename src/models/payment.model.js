// A record of money actually charged, kept separately from the subscription
// state on the user. The user says what the instructor can do now; this table
// is the history of what was paid, and it is never overwritten by a status
// change.
const { query } = require("../utils/connectDatabase");
const { compact } = require("../utils/rows");

function fromRow(row) {
  if (!row) return null;
  return compact({
    _id: row.id,
    instructor: row.instructor_id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    planId: row.plan_id,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    paidAt: row.paid_at,
    receiptUrl: row.receipt_url,
    invoiceUrl: row.invoice_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// Stripe's invoice id is the natural key. Webhooks are retried and can arrive
// more than once, so a repeat delivery updates the same row. A value missing
// from a later delivery never wipes out one that was recorded earlier.
async function upsertByInvoice(p) {
  const { rows } = await query(
    `insert into payments (
       instructor_id, stripe_invoice_id, stripe_payment_intent_id,
       stripe_subscription_id, stripe_customer_id, plan_id, description,
       amount, currency, status, period_start, period_end, paid_at,
       receipt_url, invoice_url
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (stripe_invoice_id) do update set
       instructor_id            = excluded.instructor_id,
       stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, payments.stripe_payment_intent_id),
       stripe_subscription_id   = coalesce(excluded.stripe_subscription_id, payments.stripe_subscription_id),
       stripe_customer_id       = coalesce(excluded.stripe_customer_id, payments.stripe_customer_id),
       plan_id                  = coalesce(excluded.plan_id, payments.plan_id),
       description              = coalesce(excluded.description, payments.description),
       amount                   = excluded.amount,
       currency                 = excluded.currency,
       status                   = excluded.status,
       period_start             = coalesce(excluded.period_start, payments.period_start),
       period_end               = coalesce(excluded.period_end, payments.period_end),
       paid_at                  = coalesce(excluded.paid_at, payments.paid_at),
       receipt_url              = coalesce(excluded.receipt_url, payments.receipt_url),
       invoice_url              = coalesce(excluded.invoice_url, payments.invoice_url),
       updated_at               = now()
     returning *`,
    [
      p.instructor,
      p.stripeInvoiceId,
      p.stripePaymentIntentId || null,
      p.stripeSubscriptionId || null,
      p.stripeCustomerId || null,
      p.planId || null,
      p.description || null,
      p.amount,
      String(p.currency || "").toLowerCase(),
      p.status,
      p.periodStart || null,
      p.periodEnd || null,
      p.paidAt || null,
      p.receiptUrl || null,
      p.invoiceUrl || null,
    ]
  );
  return fromRow(rows[0]);
}

// Sets the status on the newest payment matching a payment intent, or failing
// that the newest paid one for the customer.
async function setLatestStatus({ paymentIntentId, customerId }, status) {
  const match = paymentIntentId
    ? { sql: "stripe_payment_intent_id = $2", value: paymentIntentId }
    : { sql: "stripe_customer_id = $2 and status = 'paid'", value: customerId };

  const { rows } = await query(
    `update payments set status = $1, updated_at = now()
     where id = (
       select id from payments where ${match.sql}
       order by paid_at desc nulls last limit 1
     )
     returning *`,
    [status, match.value]
  );
  return fromRow(rows[0]);
}

// Billing history for one instructor, newest first.
async function listForInstructor(instructorId, limit) {
  const { rows } = await query(
    `select * from payments where instructor_id = $1
     order by paid_at desc nulls last, created_at desc
     limit $2`,
    [instructorId, limit]
  );
  return rows.map(fromRow);
}

module.exports = { upsertByInvoice, setLatestStatus, listForInstructor };
