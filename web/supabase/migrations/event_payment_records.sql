-- ============================================================
-- Payments tab (Event -> Payments): money received for many attendees at once
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- A Super Admin records one sum of money and the attendees it pays for:
--
--   cash    Cash On Hand - somebody (a pastor, a representative, an usher)
--           hands over the money they are holding for a list of attendees.
--   online  Online Payment - one transfer (GCash, BPI, Maribank...) that
--           covers a list of attendees, with its recipient, reference and
--           receipt.
--
-- The total has to equal what those attendees still owe, to the centavo,
-- before the API will save it. Each registration is then marked paid the
-- same way the desk does it; this row is the record of the money itself -
-- who held it or where it was sent, what it came to, who it was for, and
-- any notes - so a batch can always be traced back after the fact.
-- ============================================================

create table if not exists public.event_payment_records (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events(id) on delete cascade,
  kind               text not null check (kind in ('cash', 'online')),
  -- Cash On Hand: who was holding the money.
  holder_name        text,
  -- Online Payment: where it was sent, to whom, and the transfer's own proof.
  bank_name          text,
  payment_method_id  text,           -- the payment_methods row picked, if any
  recipient_name     text,
  reference          text,
  proof_url          text,
  total_amount       numeric(10, 2) not null check (total_amount > 0),
  registration_ids   uuid[] not null default '{}',
  -- [{ id, name, church, amount, from }] as they were when it was recorded,
  -- so the record still reads correctly if a registration is edited later.
  items              jsonb not null default '[]'::jsonb,
  notes              text,
  recorded_by        uuid references public.users(id) on delete set null,
  recorded_by_name   text,
  created_at         timestamptz not null default now()
);

create index if not exists event_payment_records_event_idx
  on public.event_payment_records (event_id, created_at desc);

-- Read and written only through the server (service role).
alter table public.event_payment_records enable row level security;
revoke all on table public.event_payment_records from anon, authenticated;

comment on table public.event_payment_records is
  'Payments tab: one sum of money (cash on hand or one online transfer) and the registrations it paid for.';

-- ---- Accommodation paid for while still on the waiting list ----
-- Somebody waiting for a bed (bed_wait_since - event_accommodation_waitlist.sql)
-- is charged for it on the Payments tab along with everything else, so the
-- money handed over covers the bed they are waiting for. What was taken for it
-- is kept here until the bed is given: the waiting list then adds the bed with
-- its fee already paid instead of asking for it again, and sets this back to 0.
-- Taken off the list with this still above 0 means the money is owed back -
-- the Registrations table flags it for review.
alter table public.event_registrations
  add column if not exists bed_wait_paid numeric(10, 2) not null default 0;

comment on column public.event_registrations.bed_wait_paid is
  'Paid in advance for the bed they are waiting for; used up when the waiting list gives it.';

-- ---- Review Payment, resolved ----
-- A Super Admin looked at a Review Payment flag and the registration is right
-- as it is. The flags resolved are kept here so they are not raised again:
--   { keys: [...], at, by, by_name }
-- Each key holds the values its flag was raised over (src/lib/paymentReview.js),
-- so anything that changes afterwards is flagged again.
alter table public.event_registrations
  add column if not exists payment_review_resolved jsonb;

comment on column public.event_registrations.payment_review_resolved is
  'Review Payment flags a Super Admin resolved as they are: { keys, at, by, by_name }.';

notify pgrst, 'reload schema';
