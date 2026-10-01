-- ============================================================
-- Change still to give back, from the verification desk
-- Run after registration_verification_logs.sql. Safe to re-run.
--
-- A cash payment at the desk where the desk had no change on hand: the
-- attendee is verified, and the change they are owed is written down here,
-- with the verifier who took the money. Whoever hands it over later - the
-- same verifier or another - marks it given, and their name is kept beside
-- it, so who owes whom is never a matter of memory.
-- ============================================================

create table if not exists public.registration_change_due (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  registration_ids  uuid[] not null default '{}',
  attendee_names    text not null,
  amount            numeric(10, 2) not null check (amount > 0),
  cash_received     numeric(10, 2),
  total_due         numeric(10, 2),
  -- The verifier who took the money (as they signed in at the desk).
  taken_by_id       text,
  taken_by_name     text not null,
  actor_id          uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Handed over.
  given_at          timestamptz,
  given_by_id       text,
  given_by_name     text
);

create index if not exists registration_change_due_event_idx
  on public.registration_change_due (event_id, created_at desc);

alter table public.registration_change_due enable row level security;
revoke all on table public.registration_change_due from anon, authenticated;

comment on table public.registration_change_due is
  'Change owed to attendees after a cash payment at the verification desk, and who gave it.';
