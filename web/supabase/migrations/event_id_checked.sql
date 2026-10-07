-- ============================================================
-- Attendee ID double-checked (ID Cards -> Double Check)
-- Run this AFTER event_id_printed.sql, in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS everywhere.
--
-- A printed ID gets a second look before it is handed over - the name spelt
-- right, the right church. Ticking Double Check stamps who looked and when.
-- Only a printed ID can be checked, and marking an ID as not printed clears
-- its check: a reprint has not been looked at.
-- ============================================================

alter table event_registrations add column if not exists id_checked_at timestamptz;
alter table event_registrations add column if not exists id_checked_by uuid;
