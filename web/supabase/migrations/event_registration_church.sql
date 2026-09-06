-- ============================================================
-- Church details on an event registration
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: guests registering from the public site are usually sent by another
-- church, and the team needs to know which one (and under which pastor) when
-- they arrive. Both are free text and optional - a walk-in with no church can
-- still register.
-- ============================================================

alter table event_registrations
add column if not exists church_name text;

alter table event_registrations
add column if not exists church_pastor text;
