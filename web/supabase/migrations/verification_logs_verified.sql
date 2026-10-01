-- ============================================================
-- Verification logs: attendees verified at the desk
-- Run after verification_logs_added.sql. Safe to re-run.
--
-- Verify (paid first, then Verify) checks the attendee in for the day the
-- desk is on, and is logged as 'verified' with the verifier's name.
-- ============================================================

alter table public.registration_verification_logs
  drop constraint if exists registration_verification_logs_action_check;
alter table public.registration_verification_logs
  add constraint registration_verification_logs_action_check
  check (action in ('session_start', 'session_end', 'card_tap', 'payment', 'substitute', 'added', 'verified'));
