-- ============================================================
-- Who a room is for: All Boys, All Girls, or a Family
-- Run this AFTER event_rooms.sql. Safe to re-run.
--
-- A dorm of fifteen is not handed out bed by bed to whoever turns up next:
-- it is the boys' room, or the girls' room, and a family room is one family.
-- The desk decides that as it fills the rooms, so it is a label on the room,
-- set from the Accommodation tab, and shown wherever the room is suggested.
--
-- Null means nobody has said yet - the room takes anybody.
-- ============================================================

alter table public.event_rooms
  add column if not exists occupancy text;

alter table public.event_rooms
  drop constraint if exists event_rooms_occupancy_known;
alter table public.event_rooms
  add constraint event_rooms_occupancy_known
  check (occupancy is null or occupancy in ('boys', 'girls', 'family'));

comment on column public.event_rooms.occupancy is
  'Who the room is for: boys | girls | family. Null = not set, anybody.';
