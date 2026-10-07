-- ============================================================
-- A live Google Sheet of an event's rooming list
-- Run this in the Supabase SQL editor, AFTER event_room_lists.sql.
-- Safe to re-run.
--
-- Accommodation > Live sheet makes a Google Sheet from the imported rooming
-- list - the hotel's own design, both tabs - in the Google account the app is
-- connected to (GOOGLE_* env, the same one Drive uploads use), and shares it
-- as "anyone with the link can view". From then on every change to who is in
-- which room writes the names into that sheet, so the link the hotel was sent
-- is always the current list.
--
-- One way: the system is the list. A name typed into the sheet is replaced at
-- the next change.
-- ============================================================

alter table public.event_room_lists add column if not exists sheet_id text;
alter table public.event_room_lists add column if not exists sheet_url text;
alter table public.event_room_lists add column if not exists sheet_synced_at timestamptz;
-- The last update's failure, said for a person ("the sheet was deleted"), or
-- null when the last update went through.
alter table public.event_room_lists add column if not exists sheet_error text;
-- How updates reach it: 'cells' writes just the name boxes (live, needs the
-- Google Sheets API on in the Google Cloud project); 'upload' replaces the
-- sheet's contents with the filled file (works with Drive alone).
alter table public.event_room_lists add column if not exists sheet_mode text;
