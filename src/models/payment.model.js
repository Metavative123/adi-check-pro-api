const mongoose = require("mongoose");

// A record of money actually charged, kept separately from the subscription
// state on the user. The user document says what the instructor can do now;
// this collection is the history of what was paid, and it is never overwritten
// by a status change.
const paymentSchema = new mongoose.Schema(
  {
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Stripe's invoice id is the natural key. Webhooks are retried and can
    // arrive more than once, so writes are upserted against this and a repeat
    // delivery updates the same row instead of adding another.
    stripeInvoiceId: { type: String, required: true, unique: true },
    stripePaymentIntentId: { type: String },
    stripeSubscriptionId: { type: String },
    stripeCustomerId: { type: String, index: true },

    // Which plan was being paid for, as offered at the time.
    planId: { type: String },
    description: { type: String },

    // Smallest currency unit, e.g. 1900 = GBP 19.00.
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true },

    status: {
      type: String,
      enum: ["paid", "failed", "open", "refunded", "void"],
      default: "paid",
      index: true,
    },

    // The period this payment bought.
    periodStart: { type: Date },
    periodEnd: { type: Date },
    paidAt: { type: Date },

    // Stripe-hosted links, so an instructor can fetch their own receipt
    // without this app having to render one.
    receiptUrl: { type: String },
    invoiceUrl: { type: String },
  },
  { timestamps: true }
);

// The billing history is always read newest first, per instructor.
paymentSchema.index({ instructor: 1, paidAt: -1 });

paymentSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Payment", paymentSchema);
