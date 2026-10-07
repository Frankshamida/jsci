-- ============================================================
-- Beds held for a person, by name
-- Run this in the Supabase SQL editor, AFTER event_rooms.sql and
-- event_room_guests.sql. Safe to re-run.
--
-- event_room_guests is who IS in a room: an attendee who availed
-- accommodation. Some beds are spoken for by somebody who cannot be put in a
-- room that way:
--
--   - somebody who is not an attendee at all - the speaker, the pastor's
--     driver - who still sleeps at the hotel;
--   - an attendee who has not availed accommodation yet, or not paid for it,
--     whose bed is kept for them meanwhile.
--
-- A hold is one bed, in one room, for one name. It takes the bed (a room of
-- 3 with 2 guests and 1 hold is full), it shows on the room's card, and its
-- name is written on the exported rooming list and the live Google Sheets
-- like anybody else's.
--
-- registration_id is set when the hold is for an attendee; the name is then
-- theirs, read from the registration. Null for somebody who is not one.
-- Giving that attendee a room (event_room_guests) takes their hold away - the
-- bed is theirs now, not held for them. One hold per attendee per event.
--
-- event_rooms.reserved_beds (a number of beds kept back, with a label) is
-- unchanged and still works beside this.
-- ============================================================

create table if not exists public.event_room_holds (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  room_id         uuid not null references public.event_rooms (id) on delete cascade,
  registration_id uuid references public.event_registrations (id) on delete cascade,

  -- The name on the list. For an attendee, theirs when it was held; the
  -- screens and the sheets read the registration's current name instead.
  name            text not null,
  -- "Speaker, Day 2 only", "arriving late"
  note            text,

  created_at      timestamptz not null default now(),
  created_by      uuid references public.users (id) on delete set null,

  constraint event_room_holds_name_not_blank check (length(btrim(name)) > 0)
);

-- One held bed per attendee per event.
create unique index if not exists uq_event_room_holds_reg
  on public.event_room_holds (event_id, registration_id)
  where registration_id is not null;

create index if not exists idx_event_room_holds_room on public.event_room_holds (room_id);
create index if not exists idx_event_room_holds_event on public.event_room_holds (event_id);

-- Server only: RLS on, no policy. The API routes use the service role.
alter table public.event_room_holds enable row level security;
