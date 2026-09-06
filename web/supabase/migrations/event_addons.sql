-- ============================================================
-- Paid add-on questions for events
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS / drop-then-create everywhere.
--
-- WHY: an event has ONE registration_fee, so anything optional an attendee
-- might also want ("Do you need accommodation? +200") had no home. Each row
-- here is a yes/no question the admin writes, with the amount it adds to that
-- attendee's total when they tick it.
--
-- events.registration_fee stays the BASE price. The total an attendee owes is
-- base + the fees of the add-ons they picked, and is computed server-side in
-- /api/events/registrations and stored on the registration, so a later edit to
-- an add-on's price never silently changes what an existing attendee owes.
-- ============================================================

create table if not exists event_addons (
  id uuid primary key default gen_random_uuid (),
  event_id uuid not null references events (id) on delete cascade,
  -- display order, 1-based
  position int not null default 1,
  -- the question as the attendee sees it, e.g. "Do you want accommodation?"
  question text not null,
  -- optional helper line under the question
  description text,
  -- the longer "why is this here?" text shown in the View Details popup
  details text,
  -- added to the attendee's total when they say yes
  fee numeric(10, 2) not null default 0,
  -- a required add-on is always charged (shown ticked and locked)
  is_required boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint event_addons_fee_non_negative check (fee >= 0),
  constraint event_addons_position_positive check (position >= 1)
);

create index if not exists idx_event_addons_event on event_addons (event_id, position);

-- Added after the first version of this table shipped; harmless if the column
-- was already created above.
alter table event_addons
add column if not exists details text;

-- What THIS attendee picked, snapshotted at registration time:
--   [{ "id": "...", "question": "Do you want accommodation?", "fee": 200 }]
-- Snapshotted rather than joined so the receipt still reads correctly after
-- the admin renames or reprices an add-on.
alter table event_registrations
add column if not exists addons jsonb default '[]'::jsonb;

-- The base fee charged, so `amount` (the total) can always be broken down.
alter table event_registrations
add column if not exists base_amount numeric(10, 2);

-- Reuses the update_updated_at() function created in migration_v2.sql.
drop trigger if exists update_event_addons_updated_at on event_addons;

create trigger update_event_addons_updated_at before
update on event_addons for each row
execute function update_updated_at ();

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server, so these policies are
-- permissive and the real access control lives in the API route, which
-- restricts writes to Admin / Super Admin (verifyEventManager).
alter table event_addons enable row level security;

drop policy if exists "event_addons_all" on event_addons;

create policy "event_addons_all" on event_addons for all to anon,
authenticated using (true)
with
  check (true);
