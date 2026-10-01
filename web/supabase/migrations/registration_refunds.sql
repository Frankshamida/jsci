-- ============================================================
-- Refunds, and extras cancelled at the verification desk
-- Run after verification_logs_verified.sql. Safe to re-run.
--
-- An attendee can drop an extra (accommodation, ...) at the desk.
--   Not paid yet  -> the extra comes off what they owe; a reason is kept in
--                    the verification logs ('extra_cancelled').
--   Already paid  -> it comes off, and the money goes back to them: a row
--                    here with who receives it, where (GCash, Maya, ...) and
--                    the number, sent within 2-3 business days. Marked sent
--                    by whoever sends it. Logged as 'refund' / 'refund_sent'.
-- ============================================================

create table if not exists public.registration_refunds (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  registration_id  uuid references public.event_registrations(id) on delete set null,
  attendee_name    text not null,
  extra            text not null,
  amount           numeric(10, 2) not null check (amount > 0),
  recipient_name   text not null,
  sent_to          text not null,
  account_number   text,
  reason           text not null,
  -- The verifier who took the request (as they signed in at the desk).
  verifier_id      text,
  verifier_name    text not null,
  actor_id         uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  -- Sent back.
  sent_at          timestamptz,
  sent_by_name     text
);

create index if not exists registration_refunds_event_idx
  on public.registration_refunds (event_id, created_at desc);

alter table public.registration_refunds enable row level security;
revoke all on table public.registration_refunds from anon, authenticated;

comment on table public.registration_refunds is
  'Money going back to attendees for extras cancelled after paying, and who sent it.';

-- The verification logs learn the new actions.
alter table public.registration_verification_logs
  drop constraint if exists registration_verification_logs_action_check;
alter table public.registration_verification_logs
  add constraint registration_verification_logs_action_check
  check (action in ('session_start', 'session_end', 'card_tap', 'payment', 'substitute', 'added', 'verified',
                    'extra_added', 'extra_removed', 'extra_cancelled', 'refund', 'refund_sent'));
