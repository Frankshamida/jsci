-- ============================================================
-- RFID card stock: blank cards, numbered, ready for walk-ins
-- Run after rfid_cards.sql and registration_verifiers.sql. Safe to re-run.
--
-- Under Events RFID an Admin taps blank cards one after another; each one
-- that is not anybody's yet is stored here with the next number - 1, 2, 3 -
-- which is also the number written on the card. A Walk-In Registration
-- starts by choosing one of them; once it is linked to an attendee
-- (rfid_event_cards) it shows as used and cannot be chosen again.
-- ============================================================

create table if not exists public.rfid_card_stock (
  id          uuid primary key default gen_random_uuid(),
  number      integer not null,
  -- Normalised uppercase hex, the same as rfid_cards / rfid_event_cards.
  uid         text not null,
  added_by    uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists rfid_card_stock_uid_uq on public.rfid_card_stock (uid);
create unique index if not exists rfid_card_stock_number_uq on public.rfid_card_stock (number);

alter table public.rfid_card_stock enable row level security;
revoke all on table public.rfid_card_stock from anon, authenticated;

comment on table public.rfid_card_stock is
  'Blank RFID cards stored under Events RFID, numbered in the order they were tapped, for Walk-In Registration.';
