-- ============================================================
-- RFID check-in for event registrations
-- Run this AFTER rfid_cards.sql. Safe to re-run.
--
-- rfid_cards says which card belongs to which MEMBER. That is enough at a
-- Sunday service, where everybody tapping has an account. It is not enough at
-- an event, for two reasons:
--
--   1. Half the people registered for an event are not members. A bulk or
--      walk-in registration is a name and a payment, with no user account
--      behind it, so there is no member for a card to belong to.
--   2. Being a member does not mean being registered. Tapping a member's card
--      at an event door has to answer "are they on the list for THIS event",
--      which is a question about a registration, not about a person.
--
-- So a card can also be tied straight to one registration. At the door a tap
-- is resolved in two steps: first look for a card tied to a registration for
-- this event, then fall back to the member's card and find their registration.
-- Either way the answer is a registration, and checking in sets the same
-- `attended` column the QR scanner already sets.
-- ============================================================

create table if not exists public.rfid_event_cards (
  id              uuid primary key default gen_random_uuid(),
  -- Normalised uppercase hex, same as rfid_cards. See src/lib/rfid.js.
  uid             text not null,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  -- Denormalised from the registration on purpose: every lookup at the door
  -- is "this card, at this event", and carrying the event here makes that one
  -- index hit instead of a join for each tap in a moving queue.
  event_id        uuid not null references public.events(id) on delete cascade,
  assigned_by     uuid references public.users(id) on delete set null,
  assigned_at     timestamptz not null default now(),

  -- One card cannot be two attendees at the same event. It CAN be a different
  -- attendee at a different event, which is what makes a small box of reusable
  -- cards workable: hand them out at the door, take them back at the end.
  unique (uid, event_id),
  -- And one attendee holds at most one card per event.
  unique (registration_id)
);

create index if not exists rfid_event_cards_event_idx on public.rfid_event_cards (event_id);
create index if not exists rfid_event_cards_lookup_idx on public.rfid_event_cards (event_id, uid);

comment on table public.rfid_event_cards is
  'Ties one RFID card to one event registration, for check-in at the door. Cards are reusable across events.';

-- ------------------------------------------------------------
-- Which event a tap was for, on the scan log.
--
-- Without it the log cannot answer "who came to the conference" - only "who
-- tapped something, some time". Nullable, because a tap at the office desk
-- belongs to no event.
-- ------------------------------------------------------------
alter table public.rfid_scans
  add column if not exists event_id uuid references public.events(id) on delete set null,
  add column if not exists registration_id uuid references public.event_registrations(id) on delete set null;

create index if not exists rfid_scans_event_idx on public.rfid_scans (event_id, scanned_at desc);
