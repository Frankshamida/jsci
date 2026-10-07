-- ============================================================
-- Accommodation waiting list
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- Once the rooms are full, staff adding an attendee can Reserve
-- accommodation instead of going without: the registration is saved without
-- it, and bed_wait_since puts them in line. The moment a bed is free - a
-- room added, a booking cancelled or its accommodation taken off - the
-- person who has waited longest is given it: the extra goes onto their
-- registration and its fee onto what they owe. bed_wait_addon_id is which
-- accommodation extra they asked for. Both go back to null when they are
-- given a bed or taken off the list.
-- ============================================================

alter table event_registrations add column if not exists bed_wait_since timestamptz;
alter table event_registrations add column if not exists bed_wait_addon_id uuid;

create index if not exists event_registrations_bed_wait_idx
  on event_registrations (event_id, bed_wait_since)
  where bed_wait_since is not null;
