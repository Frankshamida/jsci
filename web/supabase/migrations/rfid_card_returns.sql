-- ============================================================
-- RFID card returns
-- Run this AFTER rfid_event_checkin.sql. Safe to re-run.
--
-- At the end of an event the cards come back to the desk. Returning one
-- takes it off the attendee (the rfid_event_cards link is removed, so the
-- card is free for somebody else) and leaves a row here: who handed it back,
-- which card, and when.
--
-- The UID is kept so a return made by mistake can be reverted - the same
-- card goes back to the same attendee, as long as nobody has been given it
-- in the meantime.
-- ============================================================

create table if not exists public.rfid_card_returns (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  -- Normalised uppercase hex, same as rfid_event_cards.
  uid             text not null,
  returned_by     uuid references public.users(id) on delete set null,
  returned_at     timestamptz not null default now()
);

create index if not exists rfid_card_returns_event_idx on public.rfid_card_returns (event_id, returned_at desc);
create index if not exists rfid_card_returns_reg_idx on public.rfid_card_returns (registration_id);

comment on table public.rfid_card_returns is
  'Log of RFID cards handed back at the end of an event. Returning removes the rfid_event_cards link.';
