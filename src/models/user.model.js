const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { query } = require("../utils/connectDatabase");
const ApiError = require("../utils/ApiError");
const { isUuid, compact } = require("../utils/rows");

// Defaults for the billing record kept on every user. See db/schema.sql.
//   status       trialing / active / past_due / canceled / incomplete / none
//   plan         "trial" or "pro"
//   planId       which of the offered plans was picked, if any
//   planSelected false until the instructor has chosen a trial or a paid plan
//   cancelAt     when a cancellation takes effect (current Stripe API versions
//                express "cancel at period end" as a timestamp)
//   accessRevoked / revokedReason / revokedAt
//                set when money has gone back: a refund or a chargeback. This
//                stops everything immediately, including viewing.
//   trialCancelled
//                the instructor will not continue after the trial; the trial
//                still runs to its end date.
//   foundingPlace
//                1-50 once their first founding payment has gone through
//                (see founding_places). Kept after cancelling.
const SUBSCRIPTION_DEFAULTS = {
  status: "trialing",
  plan: "trial",
  planSelected: false,
  cancelAtPeriodEnd: false,
  accessRevoked: false,
  trialCancelled: false,
};

const SUBSCRIPTION_DATES = ["trialEndsAt", "currentPeriodEnd", "cancelAt", "revokedAt"];

const MIN_PASSWORD_LENGTH = 8;

function toDateOrUndefined(value) {
  return value ? new Date(value) : undefined;
}

function hydrateSubscription(raw = {}) {
  const sub = { ...SUBSCRIPTION_DEFAULTS, ...raw };
  for (const key of SUBSCRIPTION_DATES) sub[key] = toDateOrUndefined(sub[key]);
  return sub;
}

// Each test centre gets its own _id so it can be edited or removed by id.
function normalizeTestCenter(center) {
  const name = String(center?.name || "").trim();
  if (!name) throw new ApiError(400, "Test centre name is required");
  const code = center.code ? String(center.code).trim().toUpperCase() : "";

  return {
    _id: center._id ? String(center._id) : crypto.randomUUID(),
    name,
    ...(code ? { code } : {}),
  };
}

function checkPassword(plain) {
  if (!plain || String(plain).length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

class User {
  constructor(row) {
    this._id = row.id;
    this.name = row.name;
    this.email = row.email;
    this.role = row.role;
    this.adiBadgeNumber = row.adi_badge_number || undefined;
    this.testCenters = Array.isArray(row.test_centers) ? row.test_centers : [];
    this.subscription = hydrateSubscription(row.subscription);
    this.resetTokenHash = row.reset_token_hash || undefined;
    this.resetTokenExpires = row.reset_token_expires || undefined;
    this.createdAt = row.created_at;
    this.updatedAt = row.updated_at;

    // Kept off the enumerable fields so it can never end up in a response.
    Object.defineProperty(this, "passwordHash", {
      value: row.password,
      writable: true,
      enumerable: false,
    });
  }

  get id() {
    return this._id;
  }

  static fromRow(row) {
    return row ? new User(row) : null;
  }

  // --- Finders ---

  static async findById(id) {
    if (!isUuid(id)) return null;
    const { rows } = await query("select * from users where id = $1", [id]);
    return User.fromRow(rows[0]);
  }

  static async findByEmail(email) {
    const { rows } = await query("select * from users where email = $1", [
      String(email).trim().toLowerCase(),
    ]);
    return User.fromRow(rows[0]);
  }

  // Only a token that has not yet expired matches.
  static async findByResetToken(hash) {
    const { rows } = await query(
      "select * from users where reset_token_hash = $1 and reset_token_expires > now()",
      [hash]
    );
    return User.fromRow(rows[0]);
  }

  static async findByStripeCustomerId(customerId) {
    if (!customerId) return null;
    const { rows } = await query(
      "select * from users where subscription ->> 'stripeCustomerId' = $1 limit 1",
      [customerId]
    );
    return User.fromRow(rows[0]);
  }

  // --- Writes ---

  static async create({ name, email, password, subscription }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new ApiError(400, "Name is required");
    checkPassword(password);

    const { rows } = await query(
      `insert into users (name, email, password, subscription)
       values ($1, $2, $3, $4)
       returning *`,
      [
        cleanName,
        String(email).trim().toLowerCase(),
        await bcrypt.hash(password, 10),
        JSON.stringify(hydrateSubscription(subscription)),
      ]
    );
    return User.fromRow(rows[0]);
  }

  // Validates and stores a new password. Takes effect on save().
  async setPassword(plain) {
    checkPassword(plain);
    this.passwordHash = await bcrypt.hash(plain, 10);
  }

  comparePassword(plain) {
    return bcrypt.compare(plain, this.passwordHash);
  }

  findTestCenter(centerId) {
    return this.testCenters.find((c) => c._id === String(centerId));
  }

  // Writes the whole record back, after normalising it the same way every time.
  async save() {
    const name = String(this.name || "").trim();
    if (!name) throw new ApiError(400, "Name cannot be empty");

    const badge = this.adiBadgeNumber ? String(this.adiBadgeNumber).trim().toUpperCase() : "";
    this.testCenters = (this.testCenters || []).map(normalizeTestCenter);

    const { rows } = await query(
      `update users set
         name = $2,
         email = $3,
         password = $4,
         role = $5,
         adi_badge_number = $6,
         test_centers = $7,
         subscription = $8,
         reset_token_hash = $9,
         reset_token_expires = $10,
         updated_at = now()
       where id = $1
       returning *`,
      [
        this._id,
        name,
        String(this.email).trim().toLowerCase(),
        this.passwordHash,
        this.role,
        badge || null,
        JSON.stringify(this.testCenters),
        JSON.stringify(this.subscription || {}),
        this.resetTokenHash || null,
        this.resetTokenExpires || null,
      ]
    );

    Object.assign(this, new User(rows[0]));
    this.passwordHash = rows[0].password;
    return this;
  }

  // --- Derived values ---

  // True when the instructor still has to choose between a trial and a plan.
  get needsPlanChoice() {
    // eslint-disable-next-line global-require
    const billing = require("../config/stripe");
    if (!billing.enabled) return false;
    if (this.subscription?.status === "active") return false;
    return !this.subscription?.planSelected;
  }

  // full / read_only / revoked, worked out in one place.
  get access() {
    // eslint-disable-next-line global-require
    return require("../services/access").accessFor(this);
  }

  // Kept as "may change things", which is what every caller means by it.
  get hasAccess() {
    return this.access.canWrite;
  }

  // Whole days left in the trial, 0 once it has run out.
  get trialDaysLeft() {
    const endsAt = this.subscription?.trialEndsAt;
    if (!endsAt) return 0;
    const ms = endsAt.getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
  }

  // Lets the frontend know whether to show the "complete your profile" step.
  get profileComplete() {
    return Boolean(this.adiBadgeNumber && this.testCenters.length > 0);
  }

  // The shape every response uses. Secrets are never included.
  toJSON() {
    return {
      ...compact({
        _id: this._id,
        name: this.name,
        email: this.email,
        role: this.role,
        adiBadgeNumber: this.adiBadgeNumber,
        subscription: this.subscription,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      }),
      testCenters: this.testCenters,
      id: this._id,
      needsPlanChoice: this.needsPlanChoice,
      access: this.access,
      hasAccess: this.hasAccess,
      trialDaysLeft: this.trialDaysLeft,
      profileComplete: this.profileComplete,
    };
  }
}

module.exports = User;
