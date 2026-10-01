-- ============================================================
-- Registration Verifiers
-- Safe to re-run.
--
-- The committee people who may run Registration Verification at the door,
-- each with the RFID card they tap to start it. Added under Events RFID:
-- the card is tapped first, then the name is typed in. They do not need an
-- account in the app - the card is who they are.
--
-- /api/events/verification accepts a card listed here (and active), as well
-- as a staff card whose holder has the Registration role for the event.
-- ============================================================

create table if not exists public.registration_verifiers (
  id          uuid primary key default gen_random_uuid(),
  -- Normalised uppercase hex, the same as rfid_cards / rfid_event_cards.
  uid         text not null unique,
  firstname   text not null,
  lastname    text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists registration_verifiers_name_idx on public.registration_verifiers (lastname, firstname);

-- Server-only, like password_resets: the API reads it with the service role.
alter table public.registration_verifiers enable row level security;
revoke all on table public.registration_verifiers from anon, authenticated;

comment on table public.registration_verifiers is
  'People allowed to run Registration Verification, by the RFID card they tap.';
