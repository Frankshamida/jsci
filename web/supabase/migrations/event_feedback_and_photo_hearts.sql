-- ============================================================
-- Event feedback, and hearts on event photos
-- Run after event_photos.sql. Safe to re-run.
--
-- Both are written from the public event page (/events/<slug>) with no
-- login, through the server's own API routes - never straight from the
-- browser. So neither table is open to anon / authenticated at all.
-- ============================================================

-- ---- Feedback ----
-- Left on the Programme tab once the event is over. Up to 500 words (the API
-- holds the line; word_count is kept so the list can show it without
-- recounting). Anonymous feedback keeps no name at all - not hidden, absent.
create table if not exists public.event_feedback (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  name          text,                              -- null when anonymous
  is_anonymous  boolean not null default false,
  message       text not null,
  word_count    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists event_feedback_event_idx
  on public.event_feedback (event_id, created_at desc);

alter table public.event_feedback enable row level security;
revoke all on table public.event_feedback from anon, authenticated;

comment on table public.event_feedback is
  'Feedback left on the public event page after the event. Read by Admin / Super Admin from Events > Feedback.';

-- ---- Hearts ----
-- One row per photo per browser. visitor_id is a random id the page keeps
-- in the browser's own storage - no account behind it - so the same phone
-- hearting twice is one heart, and tapping again takes it back.
create table if not exists public.event_photo_hearts (
  photo_id    uuid not null references public.event_photos(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  visitor_id  text not null,
  created_at  timestamptz not null default now(),
  primary key (photo_id, visitor_id)
);

create index if not exists event_photo_hearts_event_idx
  on public.event_photo_hearts (event_id);

alter table public.event_photo_hearts enable row level security;
revoke all on table public.event_photo_hearts from anon, authenticated;

comment on table public.event_photo_hearts is
  'Hearts on public event photos: one per photo per browser (visitor_id), anyone can give one.';

-- The count per photo, done by the database: one row per hearted photo
-- rather than one per heart, so a popular event never runs into the API's
-- row limit and shows a short count.
create or replace view public.event_photo_heart_counts as
  select event_id, photo_id, count(*)::int as hearts
  from public.event_photo_hearts
  group by event_id, photo_id;

revoke all on table public.event_photo_heart_counts from anon, authenticated;
