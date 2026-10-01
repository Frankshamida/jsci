-- ============================================================
-- ID queue: attendees whose printed ID is being looked for
-- Run after registration_verification_logs.sql. Safe to re-run.
--
-- At the verification desk the verifier clicks the card icon beside an
-- attendee; their name goes onto /id-queue, where the person at the ID box
-- finds the printed ID - first asked, first found - and presses Found. Found
-- can be undone. Once the attendee is verified at the desk the ID is theirs:
-- claimed.
--
--   requested_at    the verifier asked for it (the queue's order)
--   found_at        the ID was found (null again after an undo)
--   claimed_at      the attendee was verified and took it
-- ============================================================

create table if not exists public.registration_id_queue (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  registration_id  uuid not null references public.event_registrations(id) on delete cascade,
  attendee_name    text not null,
  requested_by     text,
  requested_at     timestamptz not null default now(),
  found_at         timestamptz,
  found_by         text,
  claimed_at       timestamptz,
  created_by       uuid references public.users(id) on delete set null
);

-- One open request per attendee: asking twice does not queue them twice.
create unique index if not exists registration_id_queue_open_uq
  on public.registration_id_queue (registration_id) where claimed_at is null;
create index if not exists registration_id_queue_event_idx
  on public.registration_id_queue (event_id, requested_at);

alter table public.registration_id_queue enable row level security;
revoke all on table public.registration_id_queue from anon, authenticated;

comment on table public.registration_id_queue is
  'Printed IDs being looked for at the verification desk (/id-queue): requested, found, claimed.';
