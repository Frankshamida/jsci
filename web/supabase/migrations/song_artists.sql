-- ============================================================
-- Song Playlist: artists
-- Run this AFTER song_playlist.sql. Safe to re-run.
--
-- The playlist is grouped by artist. An artist has a name and a cover; a song
-- belongs to an artist and uses the artist's cover, so a cover is uploaded
-- once per artist rather than once per song. Deleting an artist deletes its
-- songs (the API cleans up their Cloudinary files).
--
-- Songs added before this existed are moved under an artist made from their
-- artist name, taking the cover of that name's earliest song.
-- ============================================================

create table if not exists public.song_artists (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  -- 1080x1080 WebP on Cloudinary, JSCI-System/song-playlist/covers/
  cover_url       text not null,
  cover_public_id text not null,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- One artist per name, whatever the capitalisation.
create unique index if not exists song_artists_name_key on public.song_artists (lower(name));

alter table public.song_playlist
  add column if not exists artist_id uuid references public.song_artists(id) on delete cascade;

-- The song's own name/cover columns are from before artists; the artist's are
-- used now.
alter table public.song_playlist alter column artist drop not null;
alter table public.song_playlist alter column cover_url drop not null;
alter table public.song_playlist alter column cover_public_id drop not null;

create index if not exists song_playlist_artist_idx on public.song_playlist (artist_id, created_at);

-- ---- Existing songs --------------------------------------------------------

insert into public.song_artists (name, cover_url, cover_public_id, created_by, created_at)
select distinct on (lower(trim(artist))) trim(artist), cover_url, cover_public_id, created_by, created_at
from public.song_playlist
where artist_id is null and coalesce(trim(artist), '') <> '' and cover_url is not null
order by lower(trim(artist)), created_at
on conflict do nothing;

update public.song_playlist s
set artist_id = a.id
from public.song_artists a
where s.artist_id is null and lower(trim(s.artist)) = lower(a.name);

-- The cover now belongs to the artist. Clearing it on the song means deleting
-- the song can never delete the artist's cover.
update public.song_playlist
set cover_url = null, cover_public_id = null
where artist_id is not null and cover_public_id is not null;

comment on table public.song_artists is
  'Artists in the dashboard Song Playlist. Each song uses its artist''s cover.';
