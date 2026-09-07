-- ============================================================
-- Every column an event registration is expected to have
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY: the registration columns arrived over several migrations, and a database
-- that has run some but not all of them fails the insert on the first column it
-- does not recognise. The API used to react to that by dropping ALL of its
-- optional columns and saving the row anyway - so one missing column ("who is
-- the representative") silently cost the row its `added_by`, `added_by_role`,
-- `registration_type` and `payment_plan` as well. The result was a walk-in
-- entered by a Super Admin that showed up as though the attendee had
-- registered themselves, with no plan attached.
--
-- The API now only drops the column actually named in the error, and refuses a
-- staff-entered registration outright rather than mislabelling it. This
-- migration is the other half: it makes sure there is nothing to drop.
-- ============================================================

alter table public.event_registrations
  -- who registered whom (event_bulk_registration.sql)
  add column if not exists group_ref text,
  add column if not exists group_size integer,
  add column if not exists representative text,
  add column if not exists registration_type text,
  add column if not exists added_by text,
  add column if not exists added_by_role text,
  -- what is owed and how it is being settled (event_flexible_payment.sql)
  add column if not exists payment_plan text not null default 'full',
  add column if not exists amount_paid numeric(10, 2) not null default 0,
  add column if not exists base_amount numeric,
  add column if not exists addons jsonb default '[]'::jsonb,
  -- where the guest was sent from (event_registration_church.sql)
  add column if not exists church_name text,
  add column if not exists church_pastor text,
  -- turning up on the day (event_registration_attendance.sql)
  add column if not exists attended boolean default false,
  add column if not exists attended_at timestamptz,
  add column if not exists attended_by uuid,
  -- the Recycle Bin (event_registration_recycle_bin.sql)
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists deleted_by_name text,
  add column if not exists deleted_reason text;

create index if not exists event_registrations_group_ref_idx
  on public.event_registrations (group_ref);

-- `status` gained a new value ('installment'). If this database has a CHECK
-- constraint listing the old values, the insert fails on the value rather than
-- on a column - so the constraint is removed and the API is left as the single
-- place the allowed statuses are defined.
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
