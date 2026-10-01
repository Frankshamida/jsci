-- ============================================================
-- Song Playlist: Spotify
-- Run this AFTER song_playlist.sql. Safe to re-run.
--
-- spotify_songs     the Song List an Admin builds from Spotify search and
--                   suggestions. Only a reference is kept (the Spotify id plus
--                   the title/artist/artwork Spotify gave us, to show the
--                   list without asking Spotify again). No audio is ever
--                   stored: songs play through Spotify's own embedded player.
--
-- spotify_api_cache shared cache of Spotify Web API answers (search results,
--                   suggestions, single tracks) so every server instance
--                   shares one copy and the app stays far under Spotify's
--                   rate limit. Rows are short-lived and pruned by the API.
--
-- Both are written only by the API with the service role; RLS is on with no
-- policies, so the anon key can read or write neither.
-- ============================================================

create table if not exists public.spotify_songs (
  id           uuid primary key default gen_random_uuid(),
  spotify_id   text not null,
  title        text not null,
  artists      text not null,
  artist_ids   text[] not null default '{}',
  album        text,
  image_url    text,             -- Spotify's artwork URL, shown as-is (never re-hosted)
  external_url text not null,    -- https://open.spotify.com/track/<id>
  duration_ms  integer,
  explicit     boolean not null default false,
  added_by     uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create unique index if not exists spotify_songs_spotify_id_key on public.spotify_songs (spotify_id);
create index if not exists spotify_songs_created_at_idx on public.spotify_songs (created_at);

-- The song's album, so the Song List can show the rest of the album.
alter table public.spotify_songs add column if not exists album_id text;

alter table public.spotify_songs enable row level security;

create table if not exists public.spotify_api_cache (
  key        text primary key,
  payload    jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists spotify_api_cache_updated_at_idx on public.spotify_api_cache (updated_at);

alter table public.spotify_api_cache enable row level security;

comment on table public.spotify_songs is 'Song Playlist > Spotify: saved Spotify track references (no audio).';
comment on table public.spotify_api_cache is 'Short-lived shared cache of Spotify Web API responses.';
