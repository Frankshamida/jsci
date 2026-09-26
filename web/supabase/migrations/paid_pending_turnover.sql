-- ============================================================
-- Paid - Pending Turnover
--
-- The attendee has paid, but the money is not at the desk yet: a committee
-- member, usher or church contact took it and has still to hand it over to
-- the treasurer. The registration counts as paid (seat held, attendance QR
-- and RFID card unlocked), but the cash is kept OUT of "Cash Collected" until
-- somebody confirms it was turned over.
--
--   pending_cash -> paid_pending_turnover -> payment_verified
--                   (money with a holder)    (money received)
--
-- The status itself is plain text, so it needs no schema change. What this
-- adds is who is holding the money and when it was handed in, so the desk
-- can chase the right person.
--
-- Safe to run more than once.
-- ============================================================

alter table public.event_registrations
  add column if not exists turnover_holder     text,         -- who has the money now
  add column if not exists turnover_marked_by  uuid,         -- the account that marked it paid
  add column if not exists turnover_marked_at  timestamptz,
  add column if not exists turned_over_at      timestamptz,  -- when it reached the treasurer
  add column if not exists turned_over_by      uuid;         -- the account that confirmed it

-- Same guard as payment_method_cash.sql: a database created with a CHECK
-- constraint listing the statuses of the day would refuse the new value.
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.event_registrations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.event_registrations drop constraint %I', con.conname);
    raise notice 'Dropped status check constraint %', con.conname;
  end loop;
end $$;

comment on column public.event_registrations.turnover_holder is
  'Status paid_pending_turnover: the person holding the money until it is turned over.';

-- Refresh the API's view of the table so the new columns can be written at once.
notify pgrst, 'reload schema';
