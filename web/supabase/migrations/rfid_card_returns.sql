-- ============================================================
-- RFID card returns
-- Run this AFTER rfid_event_checkin.sql. Safe to re-run.
--
-- At the end of an event the cards come back to the desk. Returning one
-- leaves a row here - who handed it back, which card, and when - and lets go
-- of the rfid_event_cards link, so the card is free at once: for somebody
-- else at the same event as much as for the next one, and a tap no longer
-- answers to the person who returned it. This row is the record of whose it
-- was; the ID Cards tab reads "ID Returned" and the card number from it.
--
-- Reverting a return puts the same card back on the same attendee, as long
-- as nobody at the event has been given it in the meantime.
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
  'Log of RFID cards handed back at the end of an event. Returning lets go of the rfid_event_cards link; this row records whose it was.';

-- ---- Cards returned while the link was still kept ----
-- For a while a return kept the link. Those cards already count as free
-- (src/lib/rfidEventCard.js) and are let go of the first time somebody else
-- is given one; this lets go of them all now, so every count agrees. Only a
-- link to the same attendee and card, given before it came back, is removed.
delete from public.rfid_event_cards c
using public.rfid_card_returns r
where r.registration_id = c.registration_id
  and r.uid = c.uid
  and r.returned_at >= c.assigned_at;
