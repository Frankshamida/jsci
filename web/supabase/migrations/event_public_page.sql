-- ============================================================
-- Public event page: /events/cebu-miracle-working-god
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- The QR on the back of an attendee's ID opens the event's public page. That
-- page needs three things the database did not have:
--
--   1. event_registrations.public_code - a short random code, one per
--      attendee, carried in the QR (?t=...). It is what lets the page say
--      "Welcome Frank Gomez," and what ties the photo unlock to THAT attendee.
--      It is NOT the registration id: the id is what the admin APIs act on,
--      and it should not be printed on a card anybody can photograph.
--   2. event_programme - the programme flow: sessions, speakers, meals.
--   3. event_photos - the photos attendees can open and download once they
--      unlock them with their password (LASTNAME@2026) or their RFID card.
-- ============================================================

-- ---- 1. One unique code per attendee ----
alter table public.event_registrations
  add column if not exists public_code text;

-- Existing rows get a code now; new rows get one from the default.
update public.event_registrations
  set public_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where public_code is null;

alter table public.event_registrations
  alter column public_code set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

create unique index if not exists event_registrations_public_code_key
  on public.event_registrations (public_code);

comment on column public.event_registrations.public_code is
  'Random code printed in the ID QR (/events/<slug>?t=<code>). Unique per attendee. Not the registration id.';

-- ---- 2. The programme flow ----
create table if not exists public.event_programme (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  -- Wall-clock, like the rest of the event's dates: what the programme says,
  -- not an instant converted between zones.
  day_date    date not null,
  start_time  time not null,
  end_time    time,
  title       text not null,
  speaker     text,
  -- 'session' | 'worship' | 'meal' | 'break' | 'registration' | 'other'
  kind        text not null default 'session',
  venue       text,
  notes       text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists event_programme_event_idx
  on public.event_programme (event_id, day_date, start_time);

drop trigger if exists update_event_programme_updated_at on public.event_programme;
create trigger update_event_programme_updated_at
  before update on public.event_programme
  for each row execute function update_updated_at();

-- ---- 3. Event photos ----
create table if not exists public.event_photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  public_id    text not null,           -- Cloudinary public id
  url          text not null,           -- Cloudinary secure_url
  width        integer,
  height       integer,
  bytes        integer,
  caption      text,
  uploaded_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists event_photos_event_idx
  on public.event_photos (event_id, created_at desc);

-- ---- Row-Level Security ----
-- Everything goes through the server (service role). Nothing here is read by
-- the browser directly, so RLS is on with no policies: the anon key gets
-- nothing, and the photo list can only be had through the unlock.
alter table public.event_programme enable row level security;
alter table public.event_photos enable row level security;
