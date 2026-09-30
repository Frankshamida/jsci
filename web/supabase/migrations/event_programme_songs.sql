-- ============================================================
-- Songs on a Worship programme item
-- Run this AFTER event_public_page.sql and the Song Playlist migrations
-- (song_playlist.sql, song_artists.sql). Safe to re-run.
--
-- An Admin picks songs from the Song Playlist for a Worship item; attendees
-- open the item on the event's public page and play them. song_ids keeps the
-- order they were picked in. A song deleted from the playlist simply stops
-- showing - the id is left behind and ignored, so deleting a song never has
-- to touch every programme it was on.
-- ============================================================

alter table public.event_programme
  add column if not exists song_ids uuid[] not null default '{}';

comment on column public.event_programme.song_ids is
  'Song Playlist songs (song_playlist.id) on a Worship item, in play order.';
