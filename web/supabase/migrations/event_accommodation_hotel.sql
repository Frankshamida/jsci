-- ============================================================
-- Where the attendees sleep, when it is not where the event is
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- The event's location is the venue - the hall the programme is in. The rooms
-- are often booked somewhere else: a hotel down the road, a dormitory at the
-- church. An attendee opening their Extras needs the name of the place they
-- check in to, and the venue is the wrong answer to that.
--
-- Both are optional. Left blank, the Extras page falls back to the venue.
-- Set from the Accommodation screen by an Admin or Super Admin.
-- ============================================================

alter table public.events
  add column if not exists accommodation_hotel text,
  add column if not exists accommodation_address text;

comment on column public.events.accommodation_hotel is
  'Name of the hotel or place the attendees check in to. Null = the event venue.';
comment on column public.events.accommodation_address is
  'Address of that hotel, shown to attendees on their Extras page.';
