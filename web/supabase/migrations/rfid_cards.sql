-- ============================================================
-- RFID cards
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- A card is a piece of plastic with a number in it. That is all it is. The
-- number means nothing until somebody says whose it is, so the whole feature
-- is two tables:
--
--   rfid_cards   which card belongs to which member. One row per card. A
--                member may hold several (a fob AND a card), which is why the
--                user is not unique here and the UID is.
--   rfid_scans   every tap, whether it matched anybody or not. The misses are
--                the interesting half: an unassigned card that keeps being
--                tapped is somebody standing at the door waiting to be let in,
--                and without a log of misses nobody would ever know.
--
-- The UID is stored NORMALISED - uppercase hex, no separators - because the
-- same card reads back differently depending on what is reading it. See
-- src/lib/rfid.js, which is the one place that normalisation is defined; this
-- table only ever sees what that function returns.
-- ============================================================

create table if not exists public.rfid_cards (
  id            uuid primary key default gen_random_uuid(),
  -- Normalised uppercase hex. Unique across the church: one card, one holder.
  uid           text not null unique,
  -- What the reader actually sent, kept verbatim. When a card will not match,
  -- this is the only record of what its reader really said, and comparing it
  -- with `uid` is how a format problem gets diagnosed instead of guessed at.
  raw_uid       text,
  user_id       uuid not null references public.users(id) on delete cascade,
  -- "Blue fob", "Sunday school card" - for a member holding more than one.
  label         text,
  -- Lost cards are deactivated, not deleted: the row is what proves the card
  -- was theirs, and a deleted row cannot refuse a tap.
  is_active     boolean not null default true,
  assigned_by   uuid references public.users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  last_seen_at  timestamptz,
  scan_count    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists rfid_cards_user_idx on public.rfid_cards (user_id);
create index if not exists rfid_cards_active_idx on public.rfid_cards (uid) where is_active;

comment on table public.rfid_cards is 'Physical RFID cards and fobs, and the member each one belongs to.';
comment on column public.rfid_cards.uid is 'Normalised uppercase hex UID - see src/lib/rfid.js. Never write a raw reader string here.';

-- ------------------------------------------------------------
-- Every tap, matched or not.
-- ------------------------------------------------------------
create table if not exists public.rfid_scans (
  id           uuid primary key default gen_random_uuid(),
  uid          text not null,
  raw_uid      text,
  -- Null when the card is not registered to anyone - the case worth logging.
  user_id      uuid references public.users(id) on delete set null,
  -- 'matched' | 'unknown' | 'inactive'
  result       text not null default 'unknown',
  -- 'serial' (Arduino over USB) | 'keyboard' (USB reader typing) | 'manual'
  source       text,
  -- Who was signed in at the desk when the card was tapped.
  scanned_by   uuid references public.users(id) on delete set null,
  scanned_at   timestamptz not null default now()
);

create index if not exists rfid_scans_time_idx on public.rfid_scans (scanned_at desc);
create index if not exists rfid_scans_uid_idx on public.rfid_scans (uid);
create index if not exists rfid_scans_user_idx on public.rfid_scans (user_id, scanned_at desc);

comment on table public.rfid_scans is 'Log of every card tap, including ones that matched no member.';

-- ------------------------------------------------------------
-- The scans table grows one row per tap forever, and nobody needs to know
-- about a tap from two years ago. Nothing here deletes anything - that is a
-- decision for whoever runs the database - but the index above is what keeps
-- "the last fifty scans" fast no matter how many there are behind it.
-- ------------------------------------------------------------
