-- ============================================================
-- Mode of Payment: Cash as a third kind of channel
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS everywhere.
-- ============================================================
--
-- Until now a payment_methods row was either 'bank' (BDO, BPI, Maribank) or
-- 'online' (GCash, Maya, PayPal) - both of them an ACCOUNT you send money to.
-- Cash is neither: nobody sends it anywhere, it is handed to a person at a
-- desk. It was therefore left out of the shared list and every screen that
-- needed it grew its own answer - a free-text "Cash" chip on the event, an
-- `allow_cash` switch on apparel, a virtual method with a null id on
-- contributions. Three spellings of one idea, none of them editable in one
-- place, and none of them able to say WHEN and WHERE to hand the money over.
--
-- So cash becomes a third category. It carries a name and instructions and
-- nothing else: there is no account number to copy, no account name, and no
-- QR to scan. Those columns simply stay null on a cash row.
--
--   category = 'cash'   e.g. name "Cash on the day"
--                       notes "Pay at the registration desk on the day of the
--                       event. Bring the exact amount if you can."
--
-- `category` is a plain text column with no check constraint, so widening the
-- allowed set is an application-level change - nothing to alter here. The
-- statements below only backfill and document.

-- Older rows predate the column default; make sure nothing is left categoryless,
-- since the UI groups by this value and a null would vanish from every tab.
update payment_methods set category = 'bank' where category is null or btrim(category) = '';

-- A cash row has no account to pay into. If a channel was switched over to cash
-- after it was created, the stale account details would still be sitting in the
-- row and would show on the payer's card - so they are cleared here as well as
-- on save.
update payment_methods
   set account_number = null,
       account_name   = null,
       qr_url         = null
 where category = 'cash'
   and (account_number is not null or account_name is not null or qr_url is not null);

-- Cash is drawn in amber wherever it appears (.pm-logo-cash in dashboard.css) -
-- green already means "online payment" - so a cash row left on the blue bank
-- default would look wrong the moment it had no logo.
update payment_methods
   set logo_color = '#d97706'
 where category = 'cash'
   and (logo_color is null or logo_color = '#1e3a8a');

-- The existing category index already covers 'cash'; this is here only so the
-- migration is self-contained when run against an older database.
create index if not exists idx_payment_methods_category on payment_methods(category);

-- ============================================================
-- A registration settled in cash gets its own status: 'pending_cash'.
--
-- It could not reuse either of the two that already existed.
-- 'payment_submitted' means "money sent, an admin has to check the proof", and
-- a cash payer has sent nothing and has no proof - it would fill the
-- verification queue with rows there is nothing to verify. 'pending_payment'
-- means "nobody has paid anything", which is true but costs the registrant
-- their seat: that status is deliberately absent from SLOT_HOLDING_STATUSES
-- (see src/lib/eventSlots.js), so the event would happily oversell to online
-- payers while somebody who arranged to pay at the desk was left without a
-- place. Cash is pending BY ARRANGEMENT, and the seat is held for it.
--
-- It is NOT in VERIFIED_STATUSES: the seat is theirs, but the door still asks
-- for the money first. Staff use "Collect Cash & Verify" at the desk, which
-- moves the row to 'payment_verified' and unlocks the attendance QR, the RFID
-- card and the kit in one action.
--
-- The status column is plain text with the allowed values defined in the API.
-- Some databases were created with a CHECK constraint listing the statuses of
-- the day; on those, an insert carrying a new value fails on the CONSTRAINT
-- rather than on anything a reader would recognise. The same guard is in
-- event_registrations_columns.sql, repeated here so this file can be run on its
-- own and cash cannot 500 on a database that was set up differently.
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

-- ============================================================
-- Nothing else changes for events or registrations.
--
-- events.payment_method_ids already points at payment_methods rows by id, so a
-- cash channel is picked for an event exactly like a bank one. events.
-- payment_methods (the text[] of labels) still mirrors the chosen names, which
-- is what keeps the older reports and the attendee's "how did you pay" answer
-- working unchanged.
--
-- event_registrations.payment_method keeps storing the LABEL, so a registration
-- paid in cash reads "Cash on the day" forever, even if the channel is renamed
-- or hidden later. It has no payment_reference and no payment_proof_url - there
-- is no receipt to screenshot when money is handed over - and it stays
-- 'pending_cash' until an Admin confirms the money actually arrived.
-- ============================================================
