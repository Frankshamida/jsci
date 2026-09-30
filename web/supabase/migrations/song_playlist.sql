-- ============================================================
-- Song Playlist
-- Safe to re-run.
--
-- The songs behind Worship & Schedule > Song Playlist. Admins and Super
-- Admins add them; everybody who can open the section can listen.
--
-- Both files live on Cloudinary under JSCI-System/song-playlist/. The public
-- ids are kept so deleting a song also deletes its cover and its audio.
-- The cover is always stored as a 1080x1080 WebP (the upload is signed with
-- an incoming transformation that forces it).
-- ============================================================

create table if not exists public.song_playlist (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  artist           text not null,
  cover_url        text not null,
  cover_public_id  text not null,
  audio_url        text not null,
  audio_public_id  text not null,
  duration_seconds numeric,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists song_playlist_created_idx on public.song_playlist (created_at);

comment on table public.song_playlist is
  'Songs in the dashboard Song Playlist. Cover + audio are Cloudinary assets.';
