-- ============================================================
-- Substitutes at the verification desk
-- Run after registration_verification_logs.sql. Safe to re-run.
--
-- Somebody registered cannot come, and somebody else comes in their place.
-- The registration now carries the substitute's name (attendee_name,
-- attendee_firstname, attendee_lastname - what the ID, the door and the lists
-- read), and the name it was registered under is kept here, never lost:
--
--   original_attendee_name   the registered name, set the FIRST time only, so a
--                            second substitute still points back to the first
--   substituted_at / _by / _by_name   when and by whom
--
-- Putting the registered name back clears all four.
-- ============================================================

alter table public.event_registrations
  add column if not exists original_attendee_name text,
  add column if not exists substituted_at timestamptz,
  add column if not exists substituted_by text,
  add column if not exists substituted_by_name text;

-- The verification logs learn a 'substitute' action.
alter table public.registration_verification_logs
  drop constraint if exists registration_verification_logs_action_check;
alter table public.registration_verification_logs
  add constraint registration_verification_logs_action_check
  check (action in ('session_start', 'session_end', 'card_tap', 'payment', 'substitute'));
