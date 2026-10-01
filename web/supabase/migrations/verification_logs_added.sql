-- ============================================================
-- Verification logs: attendees added at the desk
-- Run after registration_substitutes.sql. Safe to re-run.
--
-- A walk-in or late registration entered while a verifier is signed in is
-- logged as 'added', with the verifier's name. The registration itself says
-- so too: added_by is the verifier, added_by_role is 'Verifier'.
-- ============================================================

alter table public.registration_verification_logs
  drop constraint if exists registration_verification_logs_action_check;
alter table public.registration_verification_logs
  add constraint registration_verification_logs_action_check
  check (action in ('session_start', 'session_end', 'card_tap', 'payment', 'substitute', 'added'));
