-- ============================================================
-- Per-day schedules for multi-day events
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS / drop-then-create everywhere.
--
-- WHY: events.event_date + events.end_date can only express ONE continuous
-- span, so a 3-day conference running 6-9pm Fri, 9am-5pm Sat and 1-4pm Sun
-- was previously stored as "Fri 6pm -> Sun 4pm" (i.e. also overnight, which
-- is wrong). This table holds the real per-day sessions.
--
-- events.event_date / end_date are STILL maintained by the API as the overall
-- min(starts_at) / max(ends_at), so every existing query, sort and public
-- listing keeps working untouched. This table is purely additive.
-- ============================================================

create table if not exists event_days (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  -- 1-based position within the event: Day 1, Day 2, ...
  day_number int not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- optional per-day heading, e.g. "Opening Night", "Workshops"
  label text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint event_days_day_number_positive check (day_number >= 1),
  constraint event_days_end_after_start check (ends_at is null or ends_at >= starts_at),
  -- one row per day per event; also lets the API upsert on conflict
  constraint event_days_event_day_unique unique (event_id, day_number)
);

create index if not exists idx_event_days_event on event_days (event_id);
create index if not exists idx_event_days_starts on event_days (starts_at);

-- Reuses the update_updated_at() function created in migration_v2.sql.
drop trigger if exists update_event_days_updated_at on event_days;

create trigger update_event_days_updated_at
  before update on event_days
  for each row
  execute function update_updated_at ();

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server, so these policies are
-- permissive and the real access control lives in the API route, which
-- restricts writes to Admin / Super Admin (verifyEventManager).
alter table event_days enable row level security;

drop policy if exists "event_days_all" on event_days;

create policy "event_days_all" on event_days for all to anon,
authenticated using (true)
with
  check (true);
