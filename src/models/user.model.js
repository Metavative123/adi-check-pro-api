const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// An instructor can work out of several test centres.
// Each one gets its own _id so it can be removed by id.
const testCenterSchema = new mongoose.Schema({
  name: { type: String, required: [true, "Test centre name is required"], trim: true },
  code: { type: String, trim: true, uppercase: true },
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false, // never returned unless explicitly asked for
    },
    role: {
      type: String,
      enum: ["instructor", "admin"],
      default: "instructor",
    },

    // --- Filled in after sign up, from the profile page. ---
    // Not collected at registration, so both are optional here.
    adiBadgeNumber: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true, // lets many users have no badge number without clashing
    },
    testCenters: {
      type: [testCenterSchema],
      default: [],
    },
    // --- Billing ---
    // Everything Stripe tells us, kept locally so the app never has to call
    // Stripe just to render a page.
    subscription: {
      status: {
        type: String,
        enum: ["trialing", "active", "past_due", "canceled", "incomplete", "none"],
        default: "trialing",
      },
      plan: { type: String, default: "trial" },
      // Which of the offered plans was picked, if any.
      planId: { type: String },
      // False until the instructor has chosen a trial or a paid plan. Existing
      // accounts default to false, so they are asked on their next visit.
      planSelected: { type: Boolean, default: false },
      trialEndsAt: { type: Date },
      stripeCustomerId: { type: String, index: true },
      stripeSubscriptionId: { type: String },
      currentPeriodEnd: { type: Date },
      cancelAtPeriodEnd: { type: Boolean, default: false },
      // When the cancellation takes effect. Current Stripe API versions express
      // "cancel at period end" as a `cancel_at` timestamp rather than a flag,
      // and it can also be a custom date, so the date itself is what matters.
      cancelAt: { type: Date },

      // Set when money has gone back: a refund or a chargeback. This stops
      // everything immediately, including viewing, and outranks any period
      // the instructor had otherwise paid for.
      accessRevoked: { type: Boolean, default: false },
      revokedReason: { type: String, enum: ["refund", "dispute", "manual"] },
      revokedAt: { type: Date },

      // The instructor said they will not continue after the trial. The trial
      // still runs to its end date - nothing was charged, so nothing is cut short.
      trialCancelled: { type: Boolean, default: false },
    },

    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

// Hash the password whenever it is set or changed.
// Mongoose 9 does not pass `next` to async hooks - just return or throw.
userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

// True when the instructor still has to choose between a trial and a plan.
// Existing accounts see the choice too, because planSelected defaults to false.
userSchema.virtual("needsPlanChoice").get(function needsPlanChoice() {
  // eslint-disable-next-line global-require
  const billing = require("../config/stripe");
  if (!billing.enabled) return false;
  if (this.subscription?.status === "active") return false;
  return !this.subscription?.planSelected;
});

// full / read_only / revoked, worked out in one place.
userSchema.virtual("access").get(function access() {
  // eslint-disable-next-line global-require
  return require("../services/access").accessFor(this);
});

// Kept as "may change things", which is what every caller means by it.
userSchema.virtual("hasAccess").get(function hasAccess() {
  return this.access.canWrite;
});

// Whole days left in the trial, 0 once it has run out.
userSchema.virtual("trialDaysLeft").get(function trialDaysLeft() {
  const endsAt = this.subscription?.trialEndsAt;
  if (!endsAt) return 0;
  const ms = endsAt.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
});

// Lets the frontend know whether to show the "complete your profile" step.
userSchema.virtual("profileComplete").get(function profileComplete() {
  return Boolean(this.adiBadgeNumber && this.testCenters.length > 0);
});

// Strip sensitive fields from every JSON response.
userSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpires;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
