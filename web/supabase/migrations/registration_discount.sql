-- ============================================================
-- A discount given at the verification desk
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- The desk sometimes takes less than the price: a senior citizen, a PWD, a
-- scholar, a fee waived by the pastor. Typed into Collect Payment, with a
-- note saying why.
--
-- amount stays what the attendee OWES, so it is lowered by the discount:
-- every total on the event (Cash Collected, Online Collected, the verifier's
-- report) then reads what was actually taken, with nothing else to change.
-- What was taken off is kept beside it, so the full price is still
-- amount + discount_amount, and nobody has to remember why a seat sold for
-- less.
-- ============================================================

alter table public.event_registrations
  add column if not exists discount_amount numeric(10, 2) not null default 0;

alter table public.event_registrations
  add column if not exists discount_note text;

alter table public.event_registrations
  add column if not exists discounted_by uuid references public.users (id) on delete set null;

alter table public.event_registrations
  add column if not exists discounted_at timestamptz;

alter table public.event_registrations
  drop constraint if exists event_registrations_discount_sane;
alter table public.event_registrations
  add constraint event_registrations_discount_sane check (discount_amount >= 0);

comment on column public.event_registrations.discount_amount is
  'Taken off at the desk. The full price is amount + discount_amount.';
comment on column public.event_registrations.discount_note is
  'Why the discount was given, as typed at the desk.';
