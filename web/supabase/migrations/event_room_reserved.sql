-- ============================================================
-- Holding a room, or some of its beds, for somebody
-- Run this AFTER event_rooms.sql. Safe to re-run.
--
-- The block always has rooms that are spoken for before the desk opens: the
-- speakers' room, the pastor's family, two beds kept back for the worship
-- team who arrive on day two. Until now that lived in the notes column, which
-- the desk does not read - so the room was handed to whoever came first.
--
-- reserved_beds is how many of the room's beds are held: pax for the whole
-- room, fewer for some of it, 0 for none. It is a count of beds KEPT BACK,
-- not a list of who is in them, so nothing has to be undone when a guest
-- leaves: anybody else may take pax - reserved_beds - guests beds, and a
-- held bed is filled only when the desk says "use the reserved bed". Taking
-- that guest out again gives the bed back to the hold by itself.
--
-- reserved_for is who it is held for, as people say it: "Speakers",
-- "Ptr. Cruz family". Shown at the desk beside the room.
-- ============================================================

alter table public.event_rooms
  add column if not exists reserved_beds integer not null default 0;

alter table public.event_rooms
  add column if not exists reserved_for text;

alter table public.event_rooms
  add column if not exists reserved_at timestamptz;

alter table public.event_rooms
  add column if not exists reserved_by uuid references public.users (id) on delete set null;

alter table public.event_rooms
  drop constraint if exists event_rooms_reserved_sane;
alter table public.event_rooms
  add constraint event_rooms_reserved_sane
  check (reserved_beds >= 0 and reserved_beds <= pax);

comment on column public.event_rooms.reserved_beds is
  'Beds held back for reserved_for: pax = the whole room, 0 = not reserved.';
comment on column public.event_rooms.reserved_for is
  'Who the held beds are for, e.g. Speakers. Null when not reserved.';
