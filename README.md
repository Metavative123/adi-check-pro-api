# ADI Check Pro API

Express + MongoDB backend for the ADI Check Pro web app.

## Run it

```bash
npm install
cp .env.example .env   # then fill in JWT_SECRET
npm run dev            # nodemon, restarts on save
npm start              # plain node
```

MongoDB must be running (local `mongod` or a MongoDB Atlas URI in `MONGO_URI`).

## Folder structure

```
src/
  server.js       start the server, connect the database
  app.js          express app, middleware, mount routes
  config/         env.js - all process.env reading happens here
  routes/         url -> controller
  controllers/    read the request, send the response
  services/       the actual business logic
  models/         mongoose schemas
  middlewares/    auth (protect, restrictTo) and error handling
  utils/          connectDatabase, ApiError, token helpers
```

The flow is always: **route -> controller -> service -> model**.

## Endpoints

| Method | Path                       | Auth | Purpose                   |
| ------ | -------------------------- | ---- | ------------------------- |
| GET    | /api/health                | -    | Is the API up             |
| POST   | /api/auth/register         | -    | Create an account         |
| POST   | /api/auth/login            | -    | Sign in, returns a JWT    |
| POST   | /api/auth/forgot-password  | -    | Request a reset token     |
| POST   | /api/auth/reset-password   | -    | Set a new password        |
| GET    | /api/auth/me               | JWT  | Current user              |
| GET    | /api/users/me              | JWT  | Profile                   |
| PATCH  | /api/users/me              | JWT  | Set name / badge / centres|
| POST   | /api/users/me/test-centers | JWT  | Add one test centre       |
| DELETE | /api/users/me/test-centers/:centerId | JWT | Remove a test centre |
| POST   | /api/tests                 | JWT  | Log a test                |
| GET    | /api/tests                 | JWT  | Recent tests              |
| GET    | /api/tests/performance     | JWT  | 12-month score and rating |
| GET    | /api/tests/report          | JWT  | PDF report data for a period |
| PATCH  | /api/tests/:testId         | JWT  | Edit a test               |
| DELETE | /api/tests/:testId         | JWT  | Delete a test             |
| GET    | /api/billing               | JWT  | Plan, trial days, access  |
| GET    | /api/billing/plans         | JWT  | The plans and their discounts |
| POST   | /api/billing/trial         | JWT  | Take the free trial (no card) |
| POST   | /api/billing/checkout      | JWT  | Start Stripe Checkout (takes planId) |
| POST   | /api/billing/portal        | JWT  | Stripe billing portal     |
| POST   | /api/billing/checkout/confirm | JWT | Apply a finished checkout |
| GET    | /api/billing/payments      | JWT  | Payment history           |
| POST   | /api/billing/webhook       | sig  | Stripe events             |

Protected routes expect `Authorization: Bearer <token>`.

Sign up only takes **name, email, password**. The ADI badge number and test
centres are set afterwards through `PATCH /api/users/me`.

## Adding a new resource

1. `models/vehicle.model.js` - the schema
2. `services/vehicle.service.js` - the logic
3. `controllers/vehicle.controller.js` - request/response
4. `routes/vehicle.routes.js` - the paths
5. Mount it in `routes/index.js`

## Editing a test

`PATCH /api/tests/:testId` returns `affectsRating`. It is `true` only when a
field the score depends on actually changed - result, fault counts, physical
intervention or verbal instruction. Editing a pupil name, date or centre comes
back `false`, and the client then refreshes the rows without re-reading the
rating.

## PDF standards report

`GET /api/tests/report?from=YYYY-MM-DD&to=YYYY-MM-DD` returns everything the PDF
needs for a period the instructor chooses: the totals, each measurement with the
arithmetic behind it, the score itemised per measurement, the rules applied, and
the individual tests.

Add `hideNames=1` and pupil names are dropped **on the server**, so a report
asked for without names never contains one. Each test is still identified by its
reference (e.g. `T-9F3A21`).

The arithmetic lives in `src/services/scoring.js`, shared with the dashboard
rating, so the PDF and the screen can never disagree.

## Performance rating

`GET /api/tests/performance` recalculates from the instructor's tests in the
last 12 months, so it is current after every logged test.

Four metrics, each with a trigger threshold. All values are configuration in
`src/config/performance.js`, and each can be overridden with an environment
variable (see `.env.example`) - nothing is hard-coded in the service:

| Metric                     | Triggers when |
| -------------------------- | ------------- |
| Driving fault average      | 6 or more     |
| Serious fault average      | 0.55 or more  |
| Physical intervention rate | 10% or more   |
| Pass rate                  | 55% or less   |

Each metric is worth 25 points, giving a score out of 100. A metric sitting
exactly on its trigger scores half marks, so **50 is the trigger line**: above
50 the metrics have headroom, below it they are past their thresholds.

The colour comes from the trigger count alone:

- **red** - 3 or more triggers
- **amber** - 1 or 2 triggers
- **green** - no triggers

Under `minTests` (default 5) tests in the window, `hasEnoughData` is `false`: the instructor is not
shown a colour, but the score and band are still returned for admin use.

## Billing

Every instructor chooses before reaching the dashboard: a free trial, or one of
the plans. Accounts created before plans existed are asked on their next visit,
because `subscription.planSelected` defaults to `false`.

The trial gives `BILLING_TRIAL_DAYS` (default 14) of full access with **no card**,
and re-visiting the page cannot restart the clock. When it runs out, `POST /api/tests` returns **402** and the
rest of the app stays readable - an expired account can still see its history.

Paying replaces the trial with a Stripe subscription. Checkout and the billing
portal are Stripe-hosted, so no card details ever reach this server.

### Plans

Defined in `src/config/plans.js` - **the one place prices live**. Amounts are
plain numbers in that file, in version control. There is deliberately no
`PLAN_*_AMOUNT` environment variable: having the price in two places meant an
edit could be silently overridden by `.env`.

| Plan       | Default | Per month | Saving |
| ---------- | ------- | --------- | ------ |
| Monthly    | GBP 19  | GBP 19.00 | -      |
| 6 months   | GBP 99  | GBP 16.50 | 13%    |
| 12 months  | GBP 159 | GBP 13.25 | 30%    |

Discounts are **calculated** against the monthly rate, never stored, so changing
an amount updates the advertised saving automatically.

### Changing a price

A Stripe price cannot be edited once created - only replaced. So:

```bash
# 1. change the amount in src/config/plans.js
# 2. create the new price
npm run stripe:setup        # prints the new id; reuses the plans that did not change
# 3. paste the printed PLAN_*_PRICE_ID into .env
# 4. confirm the app and Stripe agree
npm run stripe:check
```

`stripe:check` exists because of the one dangerous mistake here: changing the
amount and forgetting step 3. The app would then advertise the new price and
charge the old one. It compares every configured price id against Stripe and
reports amount, currency, interval, archived and test/live mismatches.

Existing subscribers stay on the price they signed up to until they switch,
which is normally what you want. Archive the old price in Stripe once nobody
is on it.

Only the price **ids** stay in the environment, because test mode and live mode
have different ones for the same plan.

### Test mode

`STRIPE_SECRET_KEY` decides the mode. With an `sk_test_` key, pay with card
`4242 4242 4242 4242`, any future expiry, any CVC. Going live is a key swap plus
a new `STRIPE_PRICE_ID` - no code changes.

Create the product and price in whichever account the key points at:

```bash
npm run stripe:setup
```

### Access levels

One function decides, in `src/services/access.js`:

| Level | Means | When |
| --- | --- | --- |
| `full` | read and write | subscribed, or inside a live trial - **including a cancelled plan, until the period already paid for ends** |
| `read_only` | view and export only | lapsed trial, ended subscription, failed payment |
| `revoked` | nothing, not even viewing | **refund or chargeback** |

Cancelling is not a punishment: the instructor keeps everything they paid for.
A refund is different - the money has gone back, so the service stops at once,
the Stripe subscription is cancelled so no further billing happens, and the app
shows a lock screen instead of any data. **A partial refund does not revoke.**

Records are never deleted by any of this.

Cancelling during the free trial keeps the remaining days: nothing was charged,
so there is nothing to cut short. The trial simply will not convert.

### Payments

Money charged is stored in its own `payments` collection, separate from the
subscription state on the user: the user document says what the instructor can
do now, the payment rows are the history of what was taken. Rows are upserted on
Stripe's invoice id, so a webhook delivered twice updates one row rather than
adding another.

### After a payment

Stripe returns the customer to `/checkout/complete?session_id=...`, a page that
sits **outside** the signed-in guard. It confirms the session server side, which
applies the subscription immediately, then sends them to the dashboard. Returning
to a guarded page instead would bounce them back to the plan screen, because the
webhook may not have arrived yet.

### Webhooks

Production relies on webhooks; they arrive whether or not anyone has the app
open - a renewal, or a card that fails next month, happens with nobody looking.

**Set this up in the Stripe dashboard** (Developers -> Webhooks -> Add endpoint):

- **Endpoint URL**: `https://<your-api-host>/api/billing/webhook`
- **Events to send**:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `charge.refunded`
  - `charge.dispute.created`
- Copy the signing secret it gives you (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

Requests without a valid signature are rejected, and the route is mounted before
`express.json()` because Stripe signs the raw bytes.

Locally, forward them with the Stripe CLI:

```bash
stripe listen --forward-to localhost:5000/api/billing/webhook
```

and put the printed `whsec_...` in `STRIPE_WEBHOOK_SECRET`. Requests without a
valid signature are rejected. If you skip this, the billing page still works:
it calls `GET /api/billing?sync=1`, which reads the live state from Stripe.
