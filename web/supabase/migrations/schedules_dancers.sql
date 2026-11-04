-- ============================================================
-- Dancers on each lineup
-- Run this in the Supabase SQL editor BEFORE deploying the app change (the
-- Monthly Planner saves this column). Safe to re-run; it only adds a column.
-- Needs schedules_musicians.sql run as well (the planner saves both).
--
-- schedules.dancers: who dances that day, by name - kept like backup_singers.
-- The choices are the Dancers (PAW) from Ministry Roles.
-- ============================================================

alter table schedules add column if not exists dancers text[] not null default '{}';
