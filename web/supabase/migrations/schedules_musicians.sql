-- ============================================================
-- Musicians on each lineup
-- Run this in the Supabase SQL editor BEFORE deploying the app change (the
-- Monthly Planner saves this column). Safe to re-run; it only adds a column.
--
-- schedules.musicians: who plays which instrument that day, by name - the
-- same way song_leader and backup_singers are kept. Keys are the musician
-- positions from Ministry Roles:
--   { "Keyboard": ["Name"], "Guitarist": ["Name", "Name"], "Bass": ["Name"], "Drummer": ["Name"] }
-- An instrument nobody plays is left out.
-- ============================================================

alter table schedules add column if not exists musicians jsonb not null default '{}'::jsonb;
