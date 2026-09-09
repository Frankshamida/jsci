-- ============================================================
-- Committee Apparel
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- The committee's own uniform store: jackets, polo shirts, shirts and IDs
-- that a member orders through the committee dashboard, and an Admin fulfils.
--
--   apparel_items        the catalogue. One row per garment, with its price,
--                        its picture and a size list carrying the stock for
--                        each size - a Medium can run out while Large has not.
--   apparel_orders       one order per basket, not per garment: somebody
--                        ordering a jacket and two shirts is ONE thing for an
--                        Admin to receive, price and hand over.
--   apparel_order_items  the lines of that basket, each with the name, size
--                        and price SNAPSHOTTED at the time of ordering, so
--                        repricing a shirt next year does not silently rewrite
--                        what somebody already paid.
-- ============================================================

-- ---- Catalogue ----
create table if not exists public.apparel_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Jacket | Polo Shirt | Shirt | ID | Other. Free text rather than an enum:
  -- the committee will invent a category the day after an enum ships.
  category text not null default 'Shirt',
  description text,
  price numeric(10, 2) not null default 0,
  -- The FIRST picture, kept as its own column so every list, thumbnail and
  -- order row can read one field without unpacking json. `images` below is
  -- the full set; this always mirrors images[0].
  image_url text,
  -- [{ "url": "...", "label": "Front" }, ...] - up to 5. A garment is bought
  -- on how it looks front and back, so one photo was never going to do.
  images jsonb not null default '[]'::jsonb,
  -- [{ "size": "M", "stock": 12 }, ...]. An EMPTY list means the item has no
  -- sizes at all - an ID card, a pin - and is ordered as "One size", with
  -- one_size_stock holding what is left of it.
  sizes jsonb not null default '[]'::jsonb,
  one_size_stock integer not null default 0,
  is_active boolean not null default true,
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Added after the first release - safe to re-run on a table that already
-- exists, which is the whole point of shipping it as its own statement.
alter table public.apparel_items add column if not exists images jsonb not null default '[]'::jsonb;

create index if not exists apparel_items_active_idx on public.apparel_items (is_active, position);

-- ---- Orders ----
create table if not exists public.apparel_orders (
  id uuid primary key default gen_random_uuid(),
  -- Short human reference ("AP-7K3QF2"), for calling out a name at a table.
  order_no text unique,
  user_id uuid not null,
  ordered_by_name text,
  -- What the person was when they ordered: 'Event Committee', 'Admin', ...
  ordered_by_role text,
  contact text,
  note text,
  -- pending -> approved -> ready -> released, or cancelled at any point.
  status text not null default 'pending',
  total numeric(10, 2) not null default 0,
  -- Money is collected in person, so the order carries its own paid flag
  -- rather than pretending to be an online checkout.
  is_paid boolean not null default false,
  paid_at timestamptz,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists apparel_orders_user_idx on public.apparel_orders (user_id, created_at desc);
create index if not exists apparel_orders_status_idx on public.apparel_orders (status, created_at desc);

-- How the order is being paid. Added after the first release, so these are
-- their own statements - safe to re-run on a table that already exists.
--   payment_method      the LABEL the payer chose, resolved on the server from
--                       the channel they picked ("GCash") or from the cash
--                       label an Admin set ("Pay Cash at Church"). Stored as
--                       text so renaming a channel later cannot rewrite what
--                       an old order says was used.
--   payment_channel_id  which payment_methods row that was, when it was one.
alter table public.apparel_orders add column if not exists payment_method text;
alter table public.apparel_orders add column if not exists payment_channel_id uuid;
alter table public.apparel_orders add column if not exists payment_reference text;

-- ---- Which payments an item accepts ----
-- Per ITEM, not per store: a jacket paid for by bank transfer and an ID that
-- is cash-only at the desk are both normal, and an Admin decides that when
-- adding the garment rather than in a separate settings screen.
--   payment_method_ids  ids into payment_methods - the same channels the
--                       events use, so editing an account number there
--                       updates every item pointing at it.
--   allow_cash          cash is not a channel in payment_methods, it is
--                       handing money to a person, so it is its own switch.
--   cash_label          what that switch is called to the payer.
alter table public.apparel_items add column if not exists payment_method_ids jsonb not null default '[]'::jsonb;
alter table public.apparel_items add column if not exists allow_cash boolean not null default true;
alter table public.apparel_items add column if not exists cash_label text;

-- Proof of payment: the screenshot a payer uploads when they settled through
-- a channel. Cash never has one - there is no receipt to screenshot when the
-- money is handed over in person.
alter table public.apparel_orders add column if not exists payment_proof_url text;

-- An earlier version of this migration created public.apparel_settings for
-- store-wide payment options. Those live on the item now. The table is left
-- alone rather than dropped - it holds nothing but stale config - and can be
-- removed by hand if you would rather not keep it.

-- ---- Order lines ----
create table if not exists public.apparel_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.apparel_orders(id) on delete cascade,
  -- Kept as a reference for restocking, but nullable: deleting a garment from
  -- the catalogue must not delete the record of somebody having ordered it.
  item_id uuid references public.apparel_items(id) on delete set null,
  item_name text not null,
  category text,
  size text,
  unit_price numeric(10, 2) not null default 0,
  quantity integer not null default 1,
  line_total numeric(10, 2) not null default 0,
  created_at timestamptz default now()
);

create index if not exists apparel_order_items_order_idx on public.apparel_order_items (order_id);

-- ---- Row-Level Security ----
-- The app talks to Supabase through the server with the service key, and every
-- route checks the caller itself (see lib/eventCommittee.js). Permissive
-- policies here, same as event_registrations, so the server can read and write.
alter table public.apparel_items enable row level security;
alter table public.apparel_orders enable row level security;
alter table public.apparel_order_items enable row level security;

drop policy if exists "apparel_items_all" on public.apparel_items;
create policy "apparel_items_all" on public.apparel_items
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "apparel_orders_all" on public.apparel_orders;
create policy "apparel_orders_all" on public.apparel_orders
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "apparel_order_items_all" on public.apparel_order_items;
create policy "apparel_order_items_all" on public.apparel_order_items
  for all to anon, authenticated using (true) with check (true);
