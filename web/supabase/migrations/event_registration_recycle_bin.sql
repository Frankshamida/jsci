-- ============================================================
-- Recycle Bin for event registrations (soft delete)
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: cancelling a registration keeps the row in the list, which is right when
-- somebody genuinely pulled out. A row typed in by mistake - a duplicate, a
-- wrong name, a test entry - should leave the list entirely. Deleting it
-- outright is unforgiving, because the money recorded against it goes with it.
--
-- So a delete is soft: the row is stamped with who removed it and when, drops
-- out of every list and total, and sits in a Recycle Bin where it can be put
-- back. Emptying the bin is the only thing that actually destroys anything.
-- ============================================================

alter table public.event_registrations
  -- when set, the row is in the bin: out of the lists, out of the totals
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  -- kept as text as well, so the bin still reads correctly if the staff
  -- account is later removed
  add column if not exists deleted_by_name text,
  add column if not exists deleted_reason text;

-- The bin is read per event and ordered by when things were binned.
create index if not exists idx_event_registrations_deleted
  on public.event_registrations (event_id, deleted_at)
  where deleted_at is not null;

-- A binned registration must not keep holding the attendee's slot: without
-- this, re-registering the person the delete was meant to make room for fails
-- on the duplicate check.
drop index if exists uniq_event_user_registration;

create unique index if not exists uniq_event_user_registration
  on public.event_registrations (event_id, user_id)
  where user_id is not null and status <> 'cancelled' and deleted_at is null;

comment on column public.event_registrations.deleted_at is
  'Set when the registration is moved to the Recycle Bin. Non-null rows are hidden from every list and total, and can be restored or permanently deleted.';
comment on column public.event_registrations.deleted_by is
  'The staff member who moved the registration to the Recycle Bin.';
comment on column public.event_registrations.deleted_reason is
  'Optional note on why the registration was removed.';
