-- ============================================================
-- Event Committee portal
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- The committee signs in with the SAME account it registered with on the main
-- site - there is no second credential store, and no second password to
-- forget. What this migration adds is the one thing the shared account cannot
-- carry on its own: whether an Admin has put that person on the committee, and
-- which events they were put on.
--
--   is_event_committee     the flag an Admin sets. Without it the account still
--                          logs in on the main site, it just cannot open the
--                          committee dashboard.
--   committee_events       which events they work. An EMPTY array means every
--                          event - that is the common case and the default, so
--                          an Admin only has to narrow it when they want to.
--   committee_requested_at stamped when someone signs up through the committee
--                          page, so an Admin can see who is waiting to be added.
-- ============================================================

alter table public.users
  add column if not exists is_event_committee boolean not null default false,
  add column if not exists committee_events jsonb default '[]'::jsonb,
  add column if not exists committee_requested_at timestamptz,
  add column if not exists committee_assigned_at timestamptz,
  add column if not exists committee_assigned_by uuid;

-- Partial index: the only question ever asked of this column is "who IS on the
-- committee", and that is a handful of rows out of the whole user table.
create index if not exists users_is_event_committee_idx
  on public.users (is_event_committee)
  where is_event_committee;

-- Waiting-list lookup for the Team tab: who asked, oldest first.
create index if not exists users_committee_requested_at_idx
  on public.users (committee_requested_at)
  where committee_requested_at is not null;
