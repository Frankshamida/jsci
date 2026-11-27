-- ============================================================
-- Removes the demo data that demo_ministry_data.sql added: exactly the rows
-- marked 'Demo data (Nov 2026)', nothing else.
-- Run it in the Supabase SQL editor.
-- ============================================================

BEGIN;
DELETE FROM attendance WHERE notes = 'Demo data (Nov 2026)';
DELETE FROM lineup_excuses WHERE admin_note = 'Demo data (Nov 2026)';
DELETE FROM schedules WHERE submitted_by = 'Demo data (Nov 2026)';
-- The demo events (their sign-ups go with them) and meetings, by their ids.
DELETE FROM event_registrations WHERE event_id::text LIKE 'de300000-0000-4000-8000-%';
DELETE FROM events WHERE id::text LIKE 'de300000-0000-4000-8000-%';
DELETE FROM meeting_rsvps WHERE meeting_id::text LIKE 'de300000-0000-4000-8000-%';
DELETE FROM ministry_meetings WHERE id::text LIKE 'de300000-0000-4000-8000-%';
COMMIT;

-- Check: all zero.
SELECT
  (SELECT count(*) FROM attendance WHERE notes = 'Demo data (Nov 2026)') AS attendance,
  (SELECT count(*) FROM lineup_excuses WHERE admin_note = 'Demo data (Nov 2026)') AS excuses,
  (SELECT count(*) FROM schedules WHERE submitted_by = 'Demo data (Nov 2026)') AS lineups,
  (SELECT count(*) FROM events WHERE id::text LIKE 'de300000-0000-4000-8000-%') AS events,
  (SELECT count(*) FROM event_registrations WHERE event_id::text LIKE 'de300000-0000-4000-8000-%') AS sign_ups,
  (SELECT count(*) FROM ministry_meetings WHERE id::text LIKE 'de300000-0000-4000-8000-%') AS meetings;
