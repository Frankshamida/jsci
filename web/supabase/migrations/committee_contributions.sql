-- ============================================================
-- Committee Contributions
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- A contribution is money the committee collects from its own members for a
-- named purpose - a Christmas outreach, a uniform fund, a venue deposit. It is
-- deliberately NOT an event registration: nobody is being booked onto
-- anything, there is no slot to confirm and no attendance to take. What it
-- shares with a registration is the shape of the money, so the columns are
-- named the same way on purpose.
--
--   committee_contributions           the drive itself - a title and what it
--                                     is for. One row per collection.
--   committee_contribution_payers     one person's share of it: what they owe
--                                     (amount_due), and whether they are
--                                     settling it at once or over time (plan).
--   committee_contribution_payments   each amount actually handed over, with
--                                     the date and the channel it came
--                                     through. A "paid in full" share gets ONE
--                                     of these rows, not zero - so there is a
--                                     single place to read money from and the
--                                     balance arithmetic is the same either
--                                     way.
--
-- The balance is never stored. It is amount_due minus the sum of the payments,
-- computed where it is read. A stored balance is a second copy of the truth,
-- and the two drift the first time a payment is corrected.
-- ============================================================

-- ---- The drive ----
create table if not exists public.committee_contributions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  -- Closed rather than deleted, once money has gone through it. Deleting is
  -- still allowed while nobody has paid - see the route.
  is_active boolean not null default true,
  position integer not null default 0,
  created_by uuid,
  created_by_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists committee_contributions_active_idx
  on public.committee_contributions (is_active, position, created_at desc);

-- ---- One person's share ----
create table if not exists public.committee_contribution_payers (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null
    references public.committee_contributions (id) on delete cascade,
  user_id uuid not null,
  -- Snapshotted at the time the share was created. An account can be renamed,
  -- deactivated or removed from the committee, and last year's sheet still has
  -- to say who paid.
  payer_name text,
  payer_email text,
  -- "Payment to Pay": what this person is down for.
  amount_due numeric(12, 2) not null default 0,
  -- 'full' | 'installment'. It changes nothing about how payments are stored -
  -- it is what the desk INTENDED, which is worth keeping: somebody on an
  -- installment plan who has not paid for a month is behind, and somebody on
  -- 'full' who has not paid at all never started.
  plan text not null default 'full',
  note text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- One share per person per drive. Two rows for the same person is two
  -- balances for one debt, and nobody can say which is right.
  unique (contribution_id, user_id)
);

create index if not exists committee_contribution_payers_drive_idx
  on public.committee_contribution_payers (contribution_id, created_at desc);
create index if not exists committee_contribution_payers_user_idx
  on public.committee_contribution_payers (user_id);

-- ---- Each amount handed over ----
create table if not exists public.committee_contribution_payments (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null
    references public.committee_contribution_payers (id) on delete cascade,
  amount numeric(12, 2) not null default 0,
  paid_on date not null default current_date,
  -- The channel, kept twice on purpose. method_id is the live link to
  -- payment_methods, so a channel can be renamed and the link survives;
  -- method_name is what it was CALLED when the money came in, so renaming
  -- "Maribank" does not rewrite a receipt somebody was handed last year.
  -- Cash carries a null id and the name 'Cash' - it is not a channel anybody
  -- administers, so it is not a row in payment_methods.
  method_id uuid,
  method_name text,
  reference text,
  note text,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz default now()
);

create index if not exists committee_contribution_payments_payer_idx
  on public.committee_contribution_payments (payer_id, paid_on desc, created_at desc);

-- ---- Row-Level Security ----
-- Same convention as the rest of this app: the server talks to Supabase with
-- the service key and does the permission check itself (Admins and Super
-- Admins only - see the route), so these policies are permissive rather than
-- being the access control.
alter table public.committee_contributions enable row level security;
alter table public.committee_contribution_payers enable row level security;
alter table public.committee_contribution_payments enable row level security;

drop policy if exists "committee_contributions_all" on public.committee_contributions;
create policy "committee_contributions_all"
  on public.committee_contributions for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "committee_contribution_payers_all" on public.committee_contribution_payers;
create policy "committee_contribution_payers_all"
  on public.committee_contribution_payers for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "committee_contribution_payments_all" on public.committee_contribution_payments;
create policy "committee_contribution_payments_all"
  on public.committee_contribution_payments for all to anon, authenticated
  using (true) with check (true);

-- ============================================================
-- Receipt numbers
-- ------------------------------------------------------------
-- Added after the first release. Safe to re-run, and safe to run on a table
-- that already has payments in it - the backfill below numbers those in the
-- order they were recorded, so nobody's existing receipt changes number later.
--
-- A sequence, not count(*) + 1. Two people at two desks recording a payment in
-- the same second both read the same count and both write receipt 42, and the
-- duplicate is only discovered when somebody is holding two slips with the
-- same number on them. A sequence hands out each value once, to one caller,
-- and never reuses it.
--
-- Gaps are expected and fine: a deleted payment takes its number out of
-- circulation rather than renumbering every receipt issued after it. A
-- receipt book works the same way - you do not renumber the stubs because one
-- was voided.
-- ============================================================

create sequence if not exists public.committee_contribution_receipt_seq
  as bigint start with 1 increment by 1;

alter table public.committee_contribution_payments
  add column if not exists receipt_no bigint;

-- Existing rows first, oldest recorded first, so the numbering matches the
-- order the money actually came in.
with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.committee_contribution_payments
  where receipt_no is null
)
update public.committee_contribution_payments p
set receipt_no = numbered.rn
from numbered
where p.id = numbered.id;

-- Then move the sequence past whatever the backfill used, or the next payment
-- recorded would collide with a receipt already handed over.
--
-- is_called = false means "hand THIS value out next", not "you already did" -
-- so on an empty table the first receipt is 1 rather than 2.
--
-- greatest() against the sequence's own position is what makes re-running this
-- safe. Deleting the two most recent payments leaves max(receipt_no) behind
-- where the sequence is; without the guard, a re-run would wind the sequence
-- back and the next payment would be handed a number somebody already has on a
-- printed slip.
select setval(
  'public.committee_contribution_receipt_seq',
  greatest(
    coalesce((select max(receipt_no) from public.committee_contribution_payments), 0) + 1,
    (select case when is_called then last_value + 1 else last_value end
       from public.committee_contribution_receipt_seq)
  ),
  false
);

alter table public.committee_contribution_payments
  alter column receipt_no set default nextval('public.committee_contribution_receipt_seq');

create unique index if not exists committee_contribution_payments_receipt_idx
  on public.committee_contribution_payments (receipt_no);
