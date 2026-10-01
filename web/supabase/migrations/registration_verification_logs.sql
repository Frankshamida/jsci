-- ============================================================
-- Registration Verification logs
-- Run after registration_verifiers.sql. Safe to re-run.
--
-- What happened at the verification desk, and who was verifying when it did:
--   session_start / session_end   a verifier signed in / out
--   card_tap                      an attendee's card was read
--   payment                       money taken (status moved, e.g. pending_cash -> payment_verified)
--
-- A payment can be reverted from Events > More > Verification Logs: the
-- registration goes back to the status it had (details.from) and the log row
-- keeps who reverted it, when, and why. Nothing is deleted.
-- ============================================================

create table if not exists public.registration_verification_logs (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  registration_id  uuid references public.event_registrations(id) on delete set null,
  action           text not null check (action in ('session_start', 'session_end', 'card_tap', 'payment')),
  attendee_name    text,
  -- The verifier as they signed in: a registration_verifiers row, a staff
  -- user, or the test password - kept as text so a deleted verifier keeps
  -- their name on the record.
  verifier_id      text,
  verifier_name    text not null,
  verifier_duty    text,
  -- The Admin / Super Admin whose dashboard the desk was running on.
  actor_id         uuid references public.users(id) on delete set null,
  details          jsonb not null default '{}'::jsonb,   -- { from, to, amount, mode, holder, uid }
  created_at       timestamptz not null default now(),
  reverted_at      timestamptz,
  reverted_by      uuid references public.users(id) on delete set null,
  reverted_by_name text,
  revert_reason    text
);

create index if not exists registration_verification_logs_event_idx
  on public.registration_verification_logs (event_id, created_at desc);

alter table public.registration_verification_logs enable row level security;
revoke all on table public.registration_verification_logs from anon, authenticated;

comment on table public.registration_verification_logs is
  'Registration Verification desk history: sessions, card taps and payments, with reverts.';
