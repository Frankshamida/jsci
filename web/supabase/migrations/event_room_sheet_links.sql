-- ============================================================
-- Your own Google Sheet, kept up to date with the rooms
-- Run this in the Supabase SQL editor, AFTER event_rooms.sql and
-- event_room_guests.sql. Safe to re-run.
--
-- Accommodation > Live sheet > My own sheet. The sheet stays the user's - in
-- their Google account, shared however they shared it. A small script is
-- pasted into it (Extensions > Apps Script) and deployed as a web app; the
-- system calls that web app to read the sheet's layout once, and then to
-- write the names into its name boxes whenever who is in which room changes.
-- See lib/roomList/ownSheet.js.
--
-- hook_url is the script's web app address. The script only answers a
-- request carrying the secret it was given when it was copied from the
-- system, and the secret is not kept here - it is worked out from the event
-- and a server key each time.
-- ============================================================

create table if not exists public.event_room_sheet_links (
  event_id   uuid primary key references public.events (id) on delete cascade,

  title      text,          -- the spreadsheet's name, as Google has it
  sheet_url  text not null, -- the link people open
  hook_url   text not null, -- https://script.google.com/macros/s/.../exec

  -- The rooms on the sheet and their name boxes, read when it was connected
  -- (and on "Read the sheet again"), with who was last put in each box.
  layout     jsonb not null default '{}'::jsonb,
  -- What each name box was last set to, so a change writes only the boxes
  -- that changed: { "ROOM ASSIGNMENT!C3": "Juan Dela Cruz", ... }
  last       jsonb not null default '{}'::jsonb,

  linked_at  timestamptz not null default now(),
  linked_by  uuid references public.users (id) on delete set null,
  synced_at  timestamptz,
  error      text           -- the last update's failure, said for a person
);

-- Server only: RLS on, no policy. The API route uses the service role.
alter table public.event_room_sheet_links enable row level security;
