-- ============================================================
-- Which floor each room is on
-- Run after event_rooms.sql. Safe to re-run.
--
-- Free text, because hotels name floors their own way: Ground, 2nd Floor,
-- Annex 2F. Set from the Add rooms / Edit room form. Null = not said.
-- ============================================================

alter table public.event_rooms
  add column if not exists floor text;

comment on column public.event_rooms.floor is
  'The floor the room is on, as the hotel names it (e.g. 3rd Floor). Null = not set.';
