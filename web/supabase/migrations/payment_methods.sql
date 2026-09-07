-- ============================================================
-- Mode of Payment (Online payments & bank transfer accounts)
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  -- 'bank' (BDO, BPI, Maribank, ...) or 'online' (GCash, Maya, PayPal, ...)
  category text not null default 'bank',
  name text not null,              -- Bank / channel name, e.g. "BDO", "GCash"
  account_number text,
  account_name text,
  -- Circle logo: an image URL when provided, otherwise the UI draws the
  -- initials of `name` on `logo_color`.
  logo_url text,
  logo_color text default '#1e3a8a',
  qr_url text,                     -- scannable QR code image (GCash/Maya/InstaPay)
  notes text,                      -- e.g. branch, reminders for the payer
  is_active boolean default true,
  sort_order integer default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Columns added after the initial release — safe to re-run on an existing table.
alter table payment_methods add column if not exists logo_url text;
alter table payment_methods add column if not exists logo_color text default '#1e3a8a';
alter table payment_methods add column if not exists notes text;
alter table payment_methods add column if not exists sort_order integer default 0;
-- Scannable QR code for the channel (GCash/Maya QR, bank InstaPay QR, ...).
alter table payment_methods add column if not exists qr_url text;

create index if not exists idx_payment_methods_category on payment_methods(category);
create index if not exists idx_payment_methods_active on payment_methods(is_active);
create index if not exists idx_payment_methods_sort on payment_methods(sort_order, created_at);

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server (service/anon key), so we add
-- permissive policies rather than relying on RLS for access control.
alter table payment_methods enable row level security;

drop policy if exists "payment_methods_all" on payment_methods;
create policy "payment_methods_all"
  on payment_methods
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ============================================================
-- Events can accept one or more of the channels above. Only the ids are
-- stored, so editing an account number here updates every event at once.
-- ============================================================
alter table events add column if not exists payment_method_ids jsonb;
