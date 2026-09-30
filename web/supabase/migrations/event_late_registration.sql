-- ============================================================
-- Late Registration
--
-- Someone who turns up after registration closed, entered at the desk by an
-- Admin or Super Admin. They are handed an RFID card first and registered on
-- it, so the row is marked as late and the table can say
-- "LATE REGISTRATION - Sep 28, 2026, 4:48 PM" under their name.
--
-- The card itself is the usual rfid_event_cards link (rfid_event_checkin.sql).
--
-- Safe to run more than once.
-- ============================================================

alter table public.event_registrations
  add column if not exists late_registration boolean not null default false;
