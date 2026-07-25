-- ============================================================
-- Event Registration & Payments  (Phase 2)
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================

-- ---- Pricing / registration config columns on events ----
alter table events add column if not exists has_fee boolean default false;
alter table events add column if not exists registration_fee numeric default 0;
alter table events add column if not exists early_bird_price numeric;
alter table events add column if not exists early_bird_deadline timestamptz;
alter table events add column if not exists payment_deadline timestamptz;
alter table events add column if not exists refund_policy text;
alter table events add column if not exists payment_instructions text;
alter table events add column if not exists payment_methods text[];            -- e.g. {'GCash','Bank Transfer','Cash'}
alter table events add column if not exists gcash_name text;
alter table events add column if not exists gcash_number text;
alter table events add column if not exists gcash_qr_url text;
alter table events add column if not exists bank_name text;
alter table events add column if not exists bank_account_name text;
alter table events add column if not exists bank_account_number text;
alter table events add column if not exists registration_required boolean default true;
alter table events add column if not exists max_participants integer;
alter table events add column if not exists registration_deadline timestamptz;

-- ---- Audience & visibility ----
-- allowed_roles: which roles may register. NULL/empty = everyone (all roles).
alter table events add column if not exists allowed_roles text[];
-- is_published: false = draft/hidden (only admins see it); true = live.
alter table events add column if not exists is_published boolean default true;

-- ---- Location / map (lat-long + Philippine address components) ----
alter table events add column if not exists latitude double precision;
alter table events add column if not exists longitude double precision;
alter table events add column if not exists loc_country text;
alter table events add column if not exists loc_region text;
alter table events add column if not exists loc_province text;
alter table events add column if not exists loc_city text;
alter table events add column if not exists loc_barangay text;

-- ---- Registrations table ----
create table if not exists event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  user_id uuid,
  attendee_name text,
  attendee_email text,
  attendee_mobile text,
  amount numeric default 0,
  payment_method text,
  payment_reference text,          -- reference / txn number the payer enters
  payment_proof_url text,          -- Cloudinary URL of the uploaded receipt
  -- pending_payment | payment_submitted | payment_verified | registered | cancelled
  status text default 'registered',
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_event_registrations_event on event_registrations(event_id);
create index if not exists idx_event_registrations_user  on event_registrations(user_id);

-- Prevent duplicate active registrations per user per event
create unique index if not exists uniq_event_user_registration
  on event_registrations(event_id, user_id)
  where user_id is not null and status <> 'cancelled';

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server (service/anon key). Either
-- disable RLS on this table, OR add permissive policies. We add policies so
-- inserts/selects/updates work. (If you prefer, you can instead run:
--   alter table event_registrations disable row level security; )
alter table event_registrations enable row level security;

drop policy if exists "event_registrations_all" on event_registrations;
create policy "event_registrations_all"
  on event_registrations
  for all
  to anon, authenticated
  using (true)
  with check (true);
