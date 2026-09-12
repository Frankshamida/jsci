-- ============================================================
-- Where the attendees of an event sleep
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- A conference that runs over three days books rooms, and the hotel sends the
-- list as a picture of a table:
--
--   TYPE OF ROOM        ROOM NUMBERS                 PAX
--   FAMILY DELUXE       308, 408 and 508             4 (1 queen, 1 double)
--   EXECUTIVE           419, 421, 423, 519, 521      4 (2 double beds)
--   STANDARD WITH VIEW  204, 205, 206, 307           2 (1 double bed)
--   DORMTYPE            FUNCTION HALL                15
--
-- Until now that picture lived in somebody's phone, which is fine right up to
-- the moment two people are told the same room number.
--
-- WHY A ROW PER ROOM, AND NOT PER TYPE
--
-- The sheet groups by type because it is shorter to write that way, and it is
-- tempting to store it the same: one row, "308, 408 and 508" in a text
-- column. That falls apart on the first question anybody actually asks - is
-- 408 taken? - because a text list cannot answer it, cannot be counted, and
-- cannot be given to one family without being re-typed.
--
-- So: one row per room. The grouping is a display concern and the screen does
-- it on the way out. Adding "308, 408, 508" in one go is a convenience of the
-- FORM, which splits the line and inserts three rows.
--
-- WHY BEDS ARE A LIST AND PAX IS A NUMBER
--
-- beds is [{ "type": "Double Bed", "count": 2 }] - what is in the room, in a
-- shape that can be counted and re-worded ("2 Double Beds") without a
-- migration. pax is what the room is SOLD as, kept separately because the two
-- genuinely differ: a family room with a queen and a double is offered as 4
-- pax, and a function hall is 15 pax with no beds in it at all. The form
-- suggests pax from the beds; the person at the desk has the last word.
--
-- Rooms belong to an EVENT, not to a venue. The same hotel hosts next year's
-- conference with a different block of rooms at a different rate, and last
-- year's assignment is not a starting point for it - it is history.
-- ============================================================

create table if not exists public.event_rooms (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,

  -- "Family Deluxe", "Executive", "Standard with View", "Dormtype". Free text
  -- and not an enum: every venue names its rooms differently, and an enum
  -- here would mean a migration per hotel.
  room_type   text not null,
  -- "308", or "Function Hall". Text, because a dorm is a hall and a hall has
  -- a name rather than a number.
  room_number text not null,

  -- How many people sleep in it.
  pax         integer not null default 1,

  -- [{ "type": "Double Bed", "count": 2 }]
  beds        jsonb not null default '[]'::jsonb,

  -- Anything the sheet says that is not one of the columns: "beside the
  -- lift", "keys with the front desk", "reserved for the speakers".
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users (id) on delete set null,

  constraint event_rooms_pax_sane check (pax >= 1 and pax <= 200),
  constraint event_rooms_type_not_blank check (length(btrim(room_type)) > 0),
  constraint event_rooms_number_not_blank check (length(btrim(room_number)) > 0)
);

-- One room number, once, per event. Case-insensitive because "Function Hall"
-- and "FUNCTION HALL" are the same hall, and the whole point of the table is
-- that nobody is given a room somebody else already has.
--
-- An index rather than a table constraint, because a constraint cannot be
-- written over an expression.
create unique index if not exists uq_event_rooms_number on public.event_rooms (event_id, lower(room_number));

-- Every read is "the rooms at this event", grouped by type.
create index if not exists idx_event_rooms_event on public.event_rooms (event_id, room_type);

-- Reuses the update_updated_at() function created in migration_v2.sql.
drop trigger if exists update_event_rooms_updated_at on public.event_rooms;

create trigger update_event_rooms_updated_at before
update on public.event_rooms for each row
execute function update_updated_at ();

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server, so these policies are
-- permissive and the real access control lives in the API route, which
-- restricts writes to Admin / Super Admin (verifyEventManager).
alter table public.event_rooms enable row level security;

drop policy if exists "event_rooms_all" on public.event_rooms;

create policy "event_rooms_all" on public.event_rooms for all to anon,
authenticated using (true)
with
  check (true);
