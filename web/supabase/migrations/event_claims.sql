-- ============================================================
-- What each attendee has collected at an event
-- Safe to re-run.
--
-- An event that runs over two days hands out more than a seat. There is a kit
-- at registration, and there are meals - lunch and dinner, on each day - and
-- the desk has to know who has already taken theirs. Without that record the
-- only controls are a highlighter on a printed list and somebody's memory,
-- and both fail in the queue they are meant to survive.
--
-- WHY A ROW PER CLAIM, AND NOT COLUMNS
--
-- The obvious shape is columns on event_registrations: kit_claimed,
-- day1_lunch, day1_dinner, day2_lunch... That breaks the first time an event
-- runs three days, and it throws away the two things actually worth having:
-- WHEN a thing was taken, and WHO handed it over. A row per claim keeps both
-- for free, and a four-day event needs no migration.
--
-- The row EXISTING is the claim. Un-claiming deletes it - a mistake at the
-- counter is undone rather than recorded as a false state, and there is no
-- "false" row to tell apart from "never asked".
--
--   kind        'kit'    the registration pack, handed over once
--               'lunch'  one meal, on one day
--               'dinner' the same
--   day_number  which day of the event. 0 for the kit, which belongs to the
--               event rather than to a day. Not NULL, because Postgres treats
--               NULLs as distinct in a UNIQUE constraint and a nullable day
--               would let the same kit be claimed twice.
-- ============================================================

create table if not exists public.event_claims (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  -- Denormalised from the registration, like rfid_event_cards.event_id: every
  -- read is "all claims at this event", and carrying it here makes that one
  -- index hit instead of a join.
  event_id        uuid not null references public.events(id) on delete cascade,

  kind            text not null check (kind in ('kit', 'lunch', 'dinner')),
  -- 0 = not tied to a day. Days are numbered from 1, matching event_days.
  day_number      integer not null default 0 check (day_number >= 0),

  claimed_at      timestamptz not null default now(),
  claimed_by      uuid references public.users(id) on delete set null,

  -- One lunch per person per day. This is the whole point of the table, so it
  -- is enforced here and not left to the application: two people on two
  -- laptops at the same counter is exactly the situation it has to survive.
  unique (registration_id, kind, day_number)
);

-- ------------------------------------------------------------
-- WHICH pieces of the kit were handed over.
--
-- The kit is not one object: an event's merch list might be a tote, a shirt
-- and a notebook, and somebody can be given two of the three because the
-- shirts in their size ran out. Recording only "kit: claimed" loses that, and
-- the person who comes back for the shirt has no way to prove it.
--
-- Item NAMES, not ids, because events.merch_items has no ids - it is a jsonb
-- array of { name, image_url } written straight from the event form. The name
-- is also what the person at the counter reads off the screen and ticks.
--
-- Only meaningful on a 'kit' row; meals have nothing to itemise. Added
-- separately so this file stays safe to re-run over a table already created.
-- ------------------------------------------------------------
alter table public.event_claims
  add column if not exists items jsonb not null default '[]'::jsonb;

comment on column public.event_claims.items is
  'For a kit claim: the names of the merch items actually handed over, as a jsonb array of strings. Empty for meals.';

-- The one read this table gets: everything claimed at one event, drawn as a
-- grid against the attendee list.
create index if not exists event_claims_event_idx
  on public.event_claims (event_id);
create index if not exists event_claims_reg_idx
  on public.event_claims (registration_id);

comment on table public.event_claims is
  'One row per thing an attendee has collected at an event - the kit, and lunch/dinner per day. The row existing IS the claim; un-claiming deletes it.';
comment on column public.event_claims.day_number is
  'Which day of the event, numbered from 1 to match event_days. 0 for claims that belong to the event rather than a day, i.e. the kit.';
