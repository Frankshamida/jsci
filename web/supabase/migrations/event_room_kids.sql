-- ============================================================
-- A kid sleeping in a parent's bed
-- Run this in the Supabase SQL editor, AFTER event_room_guests.sql. Safe to
-- re-run.
--
-- A room's pax counts beds. A small child - the Kid and 6-10 years old age
-- groups - shares the bed of the adult they came with, so a room of 4 with 4
-- adults can still take a parent's kid. The kid is put WITH an adult guest,
-- not in a bed of their own:
--
--   - it takes no bed: event_room_guests (and every count of the room's beds)
--     never sees it;
--   - it is written with the adult, on the room's card, the exported rooming
--     list and the live Google Sheets: "Frank Gomez [Kid: Miaka Arquilano]";
--   - it goes where the adult goes: moving the adult (the same guest row)
--     moves the kid, taking the adult out takes the kid out too.
--
-- One place per kid per event. Giving the kid a bed of their own
-- (event_room_guests) takes them off the adult's - and putting them with an
-- adult gives up a bed of their own.
-- ============================================================

create table if not exists public.event_room_kids (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  -- The adult whose bed they share: their room is the adult's room.
  guest_id        uuid not null references public.event_room_guests (id) on delete cascade,
  registration_id uuid not null references public.event_registrations (id) on delete cascade,

  created_at      timestamptz not null default now(),
  created_by      uuid references public.users (id) on delete set null
);

-- With one adult at a time.
create unique index if not exists uq_event_room_kids_reg
  on public.event_room_kids (event_id, registration_id);

create index if not exists idx_event_room_kids_guest on public.event_room_kids (guest_id);
create index if not exists idx_event_room_kids_event on public.event_room_kids (event_id);

-- Server only: RLS on, no policy. The API routes use the service role.
alter table public.event_room_kids enable row level security;
