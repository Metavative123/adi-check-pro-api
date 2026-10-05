-- ADI Check Pro database (Supabase / Postgres).
-- Safe to run more than once: `npm run db:setup` applies this file.

create extension if not exists pgcrypto;

-- Instructors.
-- test_centers and subscription are small nested records that are always read
-- and written together with the user, so they live on the row as jsonb.
create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  email               text not null unique,
  password            text not null,
  role                text not null default 'instructor' check (role in ('instructor', 'admin')),
  -- Optional, but unique when set (many users may have none).
  adi_badge_number    text unique,
  -- [{ "_id": uuid, "name": text, "code": text }]
  test_centers        jsonb not null default '[]'::jsonb,
  -- Everything Stripe tells us, see src/models/user.model.js.
  subscription        jsonb not null default '{}'::jsonb,
  reset_token_hash    text,
  reset_token_expires timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Webhooks find the user by their Stripe customer id.
create index if not exists users_stripe_customer_idx
  on users ((subscription ->> 'stripeCustomerId'));
create index if not exists users_reset_token_idx on users (reset_token_hash);

-- Logged driving tests.
create table if not exists tests (
  id                    uuid primary key default gen_random_uuid(),
  instructor_id         uuid not null references users (id) on delete cascade,
  -- Short human-readable id, e.g. "T-9F3A21".
  reference             text not null unique,
  pupil_name            text not null,
  test_date             timestamptz not null,
  -- A copy of the centre, not a link: past tests still read correctly after
  -- the instructor removes the centre from their profile.
  test_center_id        text not null,
  test_center_name      text not null,
  test_center_code      text,
  result                text not null check (result in ('pass', 'fail')),
  driving_faults        integer not null default 0 check (driving_faults >= 0),
  serious_faults        integer not null default 0 check (serious_faults >= 0),
  dangerous_faults      integer not null default 0 check (dangerous_faults >= 0),
  physical_intervention boolean not null default false,
  verbal_intervention   boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists tests_instructor_date_idx
  on tests (instructor_id, test_date desc, created_at desc);
create index if not exists tests_instructor_pupil_idx
  on tests (instructor_id, lower(pupil_name));

-- Money actually charged. Never overwritten by a subscription status change.
create table if not exists payments (
  id                       uuid primary key default gen_random_uuid(),
  instructor_id            uuid not null references users (id) on delete cascade,
  -- Webhooks are retried, so writes are upserted on the invoice id.
  stripe_invoice_id        text not null unique,
  stripe_payment_intent_id text,
  stripe_subscription_id   text,
  stripe_customer_id       text,
  plan_id                  text,
  description              text,
  -- Smallest currency unit, e.g. 1900 = GBP 19.00.
  amount                   integer not null check (amount >= 0),
  currency                 text not null,
  status                   text not null default 'paid'
                           check (status in ('paid', 'failed', 'open', 'refunded', 'void')),
  period_start             timestamptz,
  period_end               timestamptz,
  paid_at                  timestamptz,
  receipt_url              text,
  invoice_url              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists payments_instructor_paid_idx
  on payments (instructor_id, paid_at desc);
create index if not exists payments_customer_idx on payments (stripe_customer_id);
create index if not exists payments_intent_idx on payments (stripe_payment_intent_id);

-- Only this API (connecting as the database owner) may touch these tables.
-- Row level security with no policies shuts out Supabase's public REST API,
-- so the anon key in a browser can never read instructors or passwords.
alter table users enable row level security;
alter table tests enable row level security;
alter table payments enable row level security;
