// Shared by the Song Playlist API routes and the event public page. See
// supabase/migrations/song_playlist.sql, song_artists.sql and
// event_programme_songs.sql.
//
// Bandwidth plan (Cloudinary counts every byte it serves, and at an event a
// whole room may press play on the same song within a minute):
//   1. Listeners never get the uploaded original. They get a 64 kbps AAC
//      rendition (~0.49 MB a minute - a third smaller than 96 kbps MP3 at
//      about the same sound), made once at upload (eager) and then served
//      from Cloudinary's CDN.
//   2. The browser keeps each song after its first full download
//      (src/lib/songCache.js), shared by the dashboard and the event page, so
//      a replay on the same phone costs nothing.
//   3. Nothing is fetched before somebody presses play - no preloading.
//   4. Covers are delivered at the size they are shown, one per artist.
//   5. Songs put on a Worship programme item are warmed when the item is
//      saved, so the first listener at the event never waits for the
//      rendition to be made (and 300 phones never ask for it at once).
//   6. Budget guard: when the account passes SONG_BUDGET_PAUSE_PERCENT of its
//      monthly credits, the event page stops offering songs, so a busy event
//      cannot use up the allowance the rest of the system needs.

import { getCloudinaryConfig } from './cloudinary';
import { titleCaseEvent } from './eventTitle';
import { cached } from './serverCache';

export const SONG_PLAYLIST_FOLDER = 'JSCI-System/song-playlist';

// Incoming transformation for covers: whatever the browser sends is stored on
// Cloudinary as a 1080x1080 WebP, so the space saving cannot be skipped by a
// browser that cannot encode WebP itself.
export const SONG_COVER_TRANSFORM = 'c_fill,g_center,w_1080,h_1080,q_auto:best,f_webp';

// The rendition listeners stream: AAC in .m4a, which every phone and browser
// plays (Cloudinary does not offer Opus). SONG_AUDIO_EAGER is the same
// rendition in eager syntax (format after the slash), so the delivery URL hits
// the copy made at upload instead of making a new one.
const SONG_AUDIO_TRANSFORM = 'br_64k';
const SONG_AUDIO_FORMAT = 'm4a';
export const SONG_AUDIO_EAGER = `${SONG_AUDIO_TRANSFORM}/${SONG_AUDIO_FORMAT}`;

export const SONG_BUDGET_PAUSE_PERCENT = 90;

const COVER_THUMB_TRANSFORM = 'c_fill,w_96,h_96,q_auto,f_auto';   // rows (48px @2x)
const COVER_TILE_TRANSFORM = 'c_fill,w_240,h_240,q_auto,f_auto';  // artist tiles
const COVER_LABEL_TRANSFORM = 'c_fill,w_360,h_360,q_auto,f_auto'; // the record's label

// Only assets this feature uploaded, so a crafted request cannot point a song
// at (and later delete) some other Cloudinary file.
export const isSongPlaylistAsset = (publicId) =>
  typeof publicId === 'string' && publicId.startsWith(`${SONG_PLAYLIST_FOLDER}/`);

export const isCloudinaryHttps = (url) => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\//i.test(url);

// https://res.cloudinary.com/<cloud>/<type>/upload/v123/<id>.<ext>
//   -> https://res.cloudinary.com/<cloud>/<type>/upload/<t>/v123/<id>.<ext>
function withTransform(url, transform) {
  if (typeof url !== 'string' || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

function streamUrl(audioUrl) {
  const url = withTransform(audioUrl, SONG_AUDIO_TRANSFORM);
  if (typeof url !== 'string') return url;
  const [path, query] = url.split('?');
  const last = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const base = dot > last ? path.slice(0, dot) : path;
  return `${base}.${SONG_AUDIO_FORMAT}${query ? `?${query}` : ''}`;
}

export function withArtistUrls(row) {
  if (!row) return row;
  return {
    ...row,
    name: titleCaseEvent(row.name),
    cover_thumb_url: withTransform(row.cover_url, COVER_THUMB_TRANSFORM),
    cover_tile_url: withTransform(row.cover_url, COVER_TILE_TRANSFORM),
  };
}

// A song row joined to its artist -> what the player uses. The cover is the
// artist's; a song from before artists falls back to its own.
export function withSongUrls(row) {
  if (!row) return row;
  const { song_artists: artist, ...song } = row;
  const coverUrl = artist?.cover_url || song.cover_url;
  // Shown in title case ("How Great Is Our God") however it was typed;
  // all-caps words such as acronyms are left alone.
  return {
    ...song,
    title: titleCaseEvent(song.title),
    artist: titleCaseEvent(artist?.name || song.artist || ''),
    cover_url: coverUrl,
    stream_url: streamUrl(song.audio_url),
    cover_thumb_url: withTransform(coverUrl, COVER_THUMB_TRANSFORM),
    cover_label_url: withTransform(coverUrl, COVER_LABEL_TRANSFORM),
  };
}

// Only what a listener needs - no Cloudinary public ids or original URLs.
export function publicSong(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    artist_id: song.artist_id,
    duration_seconds: song.duration_seconds,
    cover_url: song.cover_url,
    cover_thumb_url: song.cover_thumb_url,
    cover_label_url: song.cover_label_url,
    stream_url: song.stream_url,
  };
}

const SONG_COLUMNS = 'id, title, artist, artist_id, cover_url, audio_url, duration_seconds, song_artists(name, cover_url)';

// A saved Spotify song (spotify_songs.sql) on a Worship item. It has no
// stream_url: it plays in Spotify's own embedded player.
function publicSpotifySong(row) {
  return {
    id: row.id,
    source: 'spotify',
    spotify_id: row.spotify_id,
    title: row.title,
    artist: row.artists,
    duration_seconds: row.duration_ms ? row.duration_ms / 1000 : null,
    cover_url: row.image_url,
    cover_thumb_url: row.image_url,
    cover_label_url: row.image_url,
    external_url: row.external_url,
    stream_url: null,
  };
}

// The songs with these ids, as the player needs them - uploaded songs and
// saved Spotify songs alike (a Worship item may mix both). Missing tables
// (migrations not run) read as no songs.
export async function songsForIds(supabase, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [];
  const [uploaded, spotify] = await Promise.all([
    supabase.from('song_playlist').select(SONG_COLUMNS).in('id', unique),
    supabase.from('spotify_songs').select('id, spotify_id, title, artists, image_url, external_url, duration_ms').in('id', unique),
  ]);
  return [
    ...(uploaded.error ? [] : (uploaded.data || []).map((row) => publicSong(withSongUrls(row)))),
    ...(spotify.error ? [] : (spotify.data || []).map(publicSpotifySong)),
  ];
}

// Asks Cloudinary for each song's rendition once, so it exists before the
// event. HEAD only: nothing is downloaded. Best effort and bounded - a slow
// Cloudinary never holds up saving the programme for long.
export async function warmSongRenditions(songs, timeoutMs = 8000) {
  const urls = (songs || []).map((s) => s.stream_url).filter(Boolean);
  if (!urls.length) return;
  await Promise.allSettled(urls.map((url) => fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })));
}

// Share of this month's Cloudinary credits already used, 0-100, or null if it
// cannot be read. One upstream call per 10 minutes, whatever the traffic.
export async function cloudinaryCreditsUsedPercent() {
  // A failed read is cached as null too, so a Cloudinary outage is not asked
  // again on every page view.
  return cached('song-playlist:credits', 10 * 60 * 1000, async () => {
    try {
      const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`usage ${res.status}`);
      const usage = await res.json();
      const pct = Number(usage?.credits?.used_percent);
      return Number.isFinite(pct) ? pct : null;
    } catch {
      // Unknown is not "over budget": the songs stay on.
      return null;
    }
  });
}
