-- ============================================================
-- Event Registration Attendance (QR check-in)
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================

alter table event_registrations add column if not exists attended boolean default false;
alter table event_registrations add column if not exists attended_at timestamptz;
alter table event_registrations add column if not exists attended_by uuid;
