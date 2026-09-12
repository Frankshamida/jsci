-- ============================================================
-- Who is sleeping in which room
-- Run this in the Supabase SQL editor, AFTER event_rooms.sql. Safe to re-run.
--
-- event_rooms.sql gives an event its block of rooms. This puts names in them.
--
-- WHY A ROW PER PERSON, AND WHY THE PERSON IS A REGISTRATION
--
-- The thing being housed is a registration, not a user account: half the
-- people at a conference are guests from other churches with no account here,
-- and they still need a bed. Same reasoning as rfid_event_cards and
-- event_claims - the event's list is the registration list.
--
-- ONE BED EACH, ENFORCED BY THE DATABASE
--
-- unique (event_id, registration_id) is the whole point of this table. Two
-- staff on two laptops assigning the same family at the same moment is not a
-- hypothetical - it is a Saturday - and the loser of that race must be told,
-- not silently given a second room. Moving somebody is therefore an UPDATE of
-- their row (or an upsert on that constraint), never an insert of a second.
--
-- WHAT IS NOT ENFORCED HERE
--
--   entitlement   Only somebody who paid for accommodation gets a room, and
--                 which extra means "accommodation" is a question about the
--                 event's own wording. That lives in lib/rooms.js
--                 (roomEntitlement) and is enforced by the API route, which
--                 is also where the refusal is worded.
--   capacity      A room's pax is a number on the room, and "is 308 full?" is
--                 a count of these rows. Checked in the route rather than by
--                 a trigger, so the message can name the room and its pax
--                 instead of raising a constraint violation at the desk.
--
-- Both are deliberate: the database keeps the rule that must never be broken
-- (one bed each), and the route keeps the rules that need explaining.
-- ============================================================

create table if not exists public.event_room_guests (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.event_rooms (id) on delete cascade,
  registration_id uuid not null references public.event_registrations (id) on delete cascade,
  -- Denormalised from the room, like event_claims.event_id: every read is
  -- "everybody housed at this event", and carrying it here makes that one
  -- index hit instead of a join. It is also what the one-bed-each constraint
  -- below is written against.
  event_id        uuid not null references public.events (id) on delete cascade,

  assigned_at     timestamptz not null default now(),
  assigned_by     uuid references public.users (id) on delete set null,
  -- "top bunk", "with her mother", "arriving late on day 2"
  notes           text,

  -- One bed each. See the note above: this is the rule the database keeps.
  unique (event_id, registration_id)
);

-- "Who is in 308" and "who is housed at this event" are the only two reads.
create index if not exists idx_event_room_guests_room on public.event_room_guests (room_id);
create index if not exists idx_event_room_guests_event on public.event_room_guests (event_id);

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server, so these policies are
-- permissive and the real access control lives in the API route, which
-- restricts writes to Admin / Super Admin (verifyEventManager).
alter table public.event_room_guests enable row level security;

drop policy if exists "event_room_guests_all" on public.event_room_guests;

create policy "event_room_guests_all" on public.event_room_guests for all to anon,
authenticated using (true)
with
  check (true);
