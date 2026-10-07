-- ============================================================
-- The rooming list file an event's rooms were imported from
-- Run this in the Supabase SQL editor, AFTER event_rooms.sql and
-- event_room_guests.sql. Safe to re-run.
--
-- The hotel sends its own sheet - "ROOM ASSIGNMENT", the room numbers in
-- merged boxes, a line per bed - and wants it back in the same design with
-- the names filled in. Accommodation > Import reads that file into
-- event_room_guests; Accommodation > Export writes today's names back into
-- it. To do the second, the file itself is kept, and so is where in it each
-- room's name boxes are (layout).
--
-- ONE PER EVENT
--
-- The newest import replaces the last. The list is the hotel's current
-- version of the block; an older one is not something anybody exports.
--
-- WHY THE FILE IS A COLUMN AND NOT A STORAGE OBJECT
--
-- It is a list of people's names, and the storage buckets this app already
-- has are public. A rooming list is small (tens of kilobytes; the import
-- refuses anything over 8 MB), so it is kept here, base64, behind RLS with
-- no policies at all: only the server, with the service role, can read it.
-- ============================================================

create table if not exists public.event_room_lists (
  event_id     uuid primary key references public.events (id) on delete cascade,

  file_name    text not null,
  -- xlsx | docx | csv | pdf - what the export writes back.
  file_kind    text not null,
  file_data    text not null, -- base64 of the file as imported
  file_sha     text not null, -- sha-256 of those bytes

  -- Where the names go: every room on the list and its name boxes, and who
  -- was in each box when it was imported. See lib/roomList.
  layout       jsonb not null default '{}'::jsonb,

  imported_at  timestamptz not null default now(),
  imported_by  uuid references public.users (id) on delete set null,

  constraint event_room_lists_kind_known check (file_kind in ('xlsx', 'docx', 'csv', 'pdf'))
);

-- Server only: RLS on, and no policy, so the anon and signed-in keys read
-- nothing. The API route uses the service role.
alter table public.event_room_lists enable row level security;
