-- ============================================================
-- ISOM Inquiries (public "Inquire" form on the homepage)
-- Run this in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS everywhere.
-- ============================================================

create table if not exists isom_inquiries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  mobile text,
  church_name text,
  church_role text,          -- e.g. Pastor, Elder, Usher, Member, Other
  message text,
  -- new | contacted | enrolled | closed
  status text default 'new',
  contacted_by uuid,
  contacted_at timestamptz,
  created_at timestamptz default now()
);

-- Columns added after the initial release — safe to re-run on an existing table.
alter table isom_inquiries add column if not exists church_name text;
alter table isom_inquiries add column if not exists church_role text;

create index if not exists idx_isom_inquiries_status on isom_inquiries(status);
create index if not exists idx_isom_inquiries_created on isom_inquiries(created_at desc);

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server (service/anon key), so we add
-- permissive policies rather than relying on RLS for access control.
alter table isom_inquiries enable row level security;

drop policy if exists "isom_inquiries_all" on isom_inquiries;
create policy "isom_inquiries_all"
  on isom_inquiries
  for all
  to anon, authenticated
  using (true)
  with check (true);
