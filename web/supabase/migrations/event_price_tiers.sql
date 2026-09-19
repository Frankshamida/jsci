-- ============================================================
-- Age-based pricing for events ("Adults ₱300 · 6-10 yrs ₱100 · 5 and below free")
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: an event had ONE registration_fee, so a poster that prices adults,
-- children and toddlers differently had nowhere to live. The desk was pricing
-- those by hand and the totals stopped agreeing with the registrations.
--
-- Each row here is one age group: what it is called, the ages it covers, and
-- what that group pays. An event with no rows keeps behaving exactly as before
-- - events.registration_fee is still the price, and every existing event, form
-- and report is untouched by this file.
--
-- A group may also be marked NAME ONLY (the toddlers on the poster). Those
-- still get a registration and a row of their own - the head count at the door
-- has to include them - but the form asks for nothing except their name, and
-- they are registered under a parent or guardian whose church and contact
-- number the child's row inherits.
-- ============================================================

create table if not exists event_price_tiers (
  id uuid primary key default gen_random_uuid (),
  event_id uuid not null references events (id) on delete cascade,
  -- display order, 1-based: the order the groups read on the poster
  position int not null default 1,
  -- what the group is called, e.g. "Adults", "6-10 Yrs Old", "Kids (5 below)"
  label text not null,
  -- the ages it covers. null means open-ended: min 11 / max null is "11 and up",
  -- min null / max 5 is "5 and below".
  min_age int,
  max_age int,
  -- what this group pays
  fee numeric(10, 2) not null default 0,
  -- optional early-bird price for this group, used while the event's
  -- early_bird_deadline has not passed. null means the group has no early price.
  early_fee numeric(10, 2),
  -- Kept from the first version of this file. Every group registers now - a
  -- child who is at the event is at the event, whatever they paid - so this is
  -- true everywhere and `name_only` below is what makes a toddler a toddler.
  requires_registration boolean not null default true,
  -- the small print under the price, e.g. "Kids 5 and below do not need to register"
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint event_price_tiers_fee_non_negative check (fee >= 0),
  constraint event_price_tiers_early_fee_non_negative check (early_fee is null or early_fee >= 0),
  constraint event_price_tiers_position_positive check (position >= 1),
  constraint event_price_tiers_age_order check (
    min_age is null
    or max_age is null
    or max_age >= min_age
  )
);

create index if not exists idx_event_price_tiers_event on event_price_tiers (event_id, position);

-- An add-on can cost a different amount per age group: accommodation is ₱200
-- for an adult and ₱100 for a child on the same poster. Keyed by the lower-cased
-- tier label, e.g. { "adults": 200, "6-10 yrs old": 100 }. A group missing from
-- here pays the add-on's own `fee`, so an event that prices its add-ons the
-- same for everybody leaves this empty and nothing changes.
alter table event_addons
add column if not exists tier_fees jsonb default '{}'::jsonb;

-- ---- Name-only groups (the children) ----
-- A child is registered with their name and nothing else: no church of their
-- own, no contact number, no pastor. Those come from the parent or guardian
-- they are registered under, and the form asks for that parent instead.
alter table event_price_tiers
add column if not exists name_only boolean not null default false;

-- An earlier version of this file had a "does not need to register" flag. Those
-- groups become name-only ones: still free, still nothing to fill in, but now
-- they get a row and are counted at the door.
update event_price_tiers
set
  name_only = true,
  requires_registration = true
where
  requires_registration = false;

-- ---- Who a child belongs to ----
-- The parent or guardian's own registration for this event. It is what lets a
-- parent who forgot to add their child do it afterwards without registering
-- themselves again, and what tells the desk whose child this is.
alter table event_registrations
add column if not exists guardian_registration_id uuid references event_registrations (id) on delete set null,
add column if not exists guardian_name text;

create index if not exists idx_event_registrations_guardian on event_registrations (guardian_registration_id);

-- Which age group this attendee was booked under, snapshotted as text for the
-- same reason `addons` is: renaming or removing a group later must not rewrite
-- what an existing attendee was charged. `base_amount` already holds the money.
alter table event_registrations
add column if not exists price_tier text;

-- Reuses the update_updated_at() function created in migration_v2.sql.
drop trigger if exists update_event_price_tiers_updated_at on event_price_tiers;

create trigger update_event_price_tiers_updated_at before
update on event_price_tiers for each row
execute function update_updated_at ();

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server, so these policies are
-- permissive and the real access control lives in the API route, which
-- restricts writes to Admin / Super Admin (verifyEventManager).
alter table event_price_tiers enable row level security;

drop policy if exists "event_price_tiers_all" on event_price_tiers;

create policy "event_price_tiers_all" on event_price_tiers for all to anon,
authenticated using (true)
with
  check (true);

comment on table event_price_tiers is
  'Age-based price groups for an event. No rows means the event has one price (events.registration_fee), which is how every event worked before this table existed.';
comment on column event_price_tiers.name_only is
  'true for a children''s group: registered with a name only, under a parent or guardian, whose church and contact details the child''s row inherits.';
comment on column event_registrations.guardian_registration_id is
  'For a child registered under someone: that person''s registration for the same event.';
comment on column event_registrations.guardian_name is
  'The parent or guardian''s name, kept as text so it still reads correctly if their registration is later removed.';
comment on column event_addons.tier_fees is
  'Per-age-group price overrides for this add-on, keyed by lower-cased tier label. A group not listed pays the add-on''s own fee.';
comment on column event_registrations.price_tier is
  'The age group this attendee was booked under, as it was called at the time.';
