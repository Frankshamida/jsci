-- ============================================================
-- Flexible (installment) payment plans for event registrations
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: a ₱500 conference fee is not always payable in one go. An attendee can
-- be put on a flexible plan, then pay it down over several visits. The amount
-- owed still lives on the registration (`amount`); what changes is that it can
-- be settled across many payments instead of one.
--
-- Each payment is its own row so the admin can see WHEN money came in, not just
-- how much. `amount_paid` on the registration is the running total, kept in step
-- by the API so a balance never has to be summed in the UI.
-- ============================================================

alter table public.event_registrations
  -- 'full' = one payment, 'flexible' = paid in installments
  add column if not exists payment_plan text not null default 'full',
  -- running total of everything received so far
  add column if not exists amount_paid numeric(10, 2) not null default 0;

create table if not exists public.event_registration_payments (
  id uuid primary key default gen_random_uuid (),
  registration_id uuid not null references public.event_registrations (id) on delete cascade,
  -- how much came in on this visit
  amount numeric(10, 2) not null,
  -- the date the money was handed over, which is not always the date it was typed in
  paid_on date not null default current_date,
  -- Cash, GCash, Bank Transfer...
  method text,
  -- the GCash / bank reference, when there is one
  reference text,
  note text,
  -- the staff member who recorded it
  recorded_by uuid references public.users (id) on delete set null,
  recorded_by_name text,
  created_at timestamptz default now(),
  constraint event_registration_payments_amount_positive check (amount > 0)
);

create index if not exists idx_event_reg_payments_registration
  on public.event_registration_payments (registration_id, paid_on);

-- The app talks to Supabase through the server, so the real access control is
-- in the API route (admins only). These policies mirror the other event tables.
alter table public.event_registration_payments enable row level security;

drop policy if exists "event_registration_payments_all" on public.event_registration_payments;

create policy "event_registration_payments_all" on public.event_registration_payments for all to anon,
authenticated using (true)
with
  check (true);

comment on column public.event_registrations.payment_plan is
  'full = settled in one payment; flexible = paid down in installments recorded in event_registration_payments.';
comment on column public.event_registrations.amount_paid is
  'Running total of the payments received against this registration.';
