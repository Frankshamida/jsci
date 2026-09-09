-- ============================================================
-- Event Committee: roles per event, and tasks
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- users.committee_events (from event_committee.sql) says WHICH events somebody
-- works. These two tables say what they DO there, and what they have been
-- asked to do:
--
--   committee_assignments  one row per member per event, carrying the roles
--                          they hold on it. Roles are a LIST, because one
--                          person on a small team is registration and cashier
--                          and whoever else is needed.
--   committee_tasks        something an Admin has asked a member to do, for an
--                          event or in general.
--
-- A table rather than more jsonb on `users`: an event's roster ("who is on
-- registration for the October conference") is a question asked of the event
-- as often as of the person, and that reads badly out of a blob.
-- ============================================================

-- ---- Roles per member per event ----
create table if not exists public.committee_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null references public.events(id) on delete cascade,
  -- ["Registration", "Cashier"] - free text, like the apparel categories: the
  -- committee will invent a role the day after an enum ships.
  roles jsonb not null default '[]'::jsonb,
  assigned_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- One row per person per event. Their roles live inside it.
  unique (user_id, event_id)
);

create index if not exists committee_assignments_user_idx on public.committee_assignments (user_id);
create index if not exists committee_assignments_event_idx on public.committee_assignments (event_id);

-- ---- Tasks ----
create table if not exists public.committee_tasks (
  id uuid primary key default gen_random_uuid(),
  -- Who it is for.
  user_id uuid not null,
  -- The event it belongs to, when it belongs to one. A task can also be plain
  -- committee work ("collect the IDs from the printer"), so this is nullable.
  event_id uuid references public.events(id) on delete set null,
  title text not null,
  details text,
  due_at timestamptz,
  -- open -> doing -> done, or cancelled at any point.
  status text not null default 'open',
  created_by uuid,
  created_by_name text,
  done_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists committee_tasks_user_idx on public.committee_tasks (user_id, status);
create index if not exists committee_tasks_event_idx on public.committee_tasks (event_id);

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server with the service key, and every
-- route checks the caller itself (see lib/eventCommittee.js). Permissive
-- policies here, same as the other committee tables.
alter table public.committee_assignments enable row level security;
alter table public.committee_tasks enable row level security;

drop policy if exists "committee_assignments_all" on public.committee_assignments;
create policy "committee_assignments_all" on public.committee_assignments
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "committee_tasks_all" on public.committee_tasks;
create policy "committee_tasks_all" on public.committee_tasks
  for all to anon, authenticated using (true) with check (true);
