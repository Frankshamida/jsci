-- ============================================================
-- Event photos by day (Day 1, Day 2 ...)
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- A two-day event's photos are split by the day they were taken, the same
-- way the programme is. Null = not put on a day (shown under "All").
-- ============================================================

alter table public.event_photos add column if not exists day_date date;

create index if not exists event_photos_event_day_idx
  on public.event_photos (event_id, day_date);
