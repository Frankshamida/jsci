// Spotify Web API, server side only. Used by /api/spotify (search and
// suggestions) and /api/song-playlist/spotify (the saved Song List).
//
// Spotify rules this follows (developer.spotify.com/policy and /documentation):
//   - Client Credentials flow: the secret stays on the server (no
//     NEXT_PUBLIC_), and only catalog data is read - no user data.
//   - No audio is downloaded or re-hosted. Songs play through Spotify's own
//     embedded player (open.spotify.com/embed), and every song links back to
//     Spotify. Artwork is Spotify's URL, shown as given.
//   - Spotify Content is cached only to keep the app fast and polite to the
//     API, for hours, not kept for good. The saved Song List stores a
//     reference (id, title, artist, artwork URL) the way a bookmark does.
//   - A 429 is honoured: nothing is sent to Spotify until its Retry-After has
//     passed. Calls are never retried in a loop.
//
// Staying under the rate limit (Spotify counts calls in a rolling 30 s window):
//   1. One access token per hour per instance, shared by every request, with
//      one refresh in flight at a time.
//   2. Two-level cache: process memory, then the spotify_api_cache table that
//      every instance shares. Search answers live 6 h, suggestions a day, so
//      the same search by 50 people is one Spotify call.
//   3. Concurrent identical requests share one call (single flight).
//   4. A budget of SPOTIFY_BUDGET calls per 30 s per instance, at most
//      MAX_CONCURRENT at once; past it the request waits briefly or is told
//      "busy" - Spotify is never pushed into a 429.
//   5. On a 429 every instance stops for Retry-After seconds (the pause is
//      written to the shared cache too) and stale cached answers are served.
//   6. The API routes rate-limit each user, and the browser debounces typing.

import { supabaseAdmin } from './supabase';
import { cached, cacheGet, cacheSet, cacheInvalidate } from './serverCache';

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_MARKET = String(process.env.SPOTIFY_MARKET || 'PH').toUpperCase().slice(0, 2);

// Ten results a page: the most Spotify allows a development-mode app, and
// plenty for a picker.
export const SEARCH_PAGE = 10;
const MAX_OFFSET = 100;

const WINDOW_MS = 30 * 1000;
const BUDGET = Math.max(1, Number(process.env.SPOTIFY_BUDGET) || 25);
const MAX_CONCURRENT = 3;
const MAX_WAITING = 20;
const REQUEST_TIMEOUT_MS = 8000;

const SEARCH_TTL = 6 * 60 * 60 * 1000;
const SUGGESTION_TTL = 24 * 60 * 60 * 1000;
const ALBUM_TTL = 24 * 60 * 60 * 1000;
const TRACK_TTL = 24 * 60 * 60 * 1000;
// A stale answer may still be served while Spotify is unreachable or pausing
// us, but rows are dropped after this.
const STALE_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const COOLDOWN_KEY = 'spotify:cooldown';
const CACHE_TABLE = 'spotify_api_cache';

export class SpotifyError extends Error {
  constructor(message, status = 502, retryAfterSec = 0) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

const busy = (ms) => {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return new SpotifyError(`Spotify is busy right now. Try again in ${sec} s.`, 503, sec);
};

export const spotifyConfigured = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

// ---------------------------------------------------------------- budget

const recentCalls = []; // timestamps of calls in the last WINDOW_MS
let cooldownUntil = 0;
let active = 0;
const waiting = [];

function takeBudget() {
  const now = Date.now();
  if (now < cooldownUntil) throw busy(cooldownUntil - now);
  while (recentCalls.length && now - recentCalls[0] >= WINDOW_MS) recentCalls.shift();
  if (recentCalls.length >= BUDGET) throw busy(WINDOW_MS - (now - recentCalls[0]));
  recentCalls.push(now);
}

async function acquireSlot() {
  if (active < MAX_CONCURRENT) { active += 1; return; }
  if (waiting.length >= MAX_WAITING) throw busy(2000);
  // The slot is handed over by releaseSlot, so `active` is not touched here.
  await new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

async function startCooldown(seconds) {
  const until = Date.now() + seconds * 1000;
  cooldownUntil = Math.max(cooldownUntil, until);
  // Tell the other instances too, so they do not keep calling.
  await l2Write(COOLDOWN_KEY, { until }, seconds * 1000);
}

// ----------------------------------------------------------------- token

let token = null; // { value, expiresAt }
let tokenPromise = null;

async function accessToken() {
  if (token && Date.now() < token.expiresAt) return token.value;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    if (!spotifyConfigured()) {
      throw new SpotifyError('Spotify is not set up: add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.local.', 503);
    }
    const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      const sec = Number(res.headers.get('retry-after')) || 30;
      await startCooldown(sec);
      throw busy(sec * 1000);
    }
    if (!res.ok) throw new SpotifyError(`Spotify sign-in failed (${res.status}). Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.`, 502);
    const json = await res.json();
    // Renewed two minutes early, so a token never expires mid-request.
    token = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in || 3600) - 120) * 1000 };
    return token.value;
  })().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

// One Web API GET, inside the budget. A 401 gets one retry with a new token
// (the old one expired); a 429 starts the cooldown and is never retried.
async function spotifyGet(path, params = {}) {
  const url = new URL(`${API}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });

  await acquireSlot();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      takeBudget();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401 && attempt === 0) { token = null; continue; }
      if (res.status === 429) {
        const sec = Number(res.headers.get('retry-after')) || 30;
        await startCooldown(sec);
        throw busy(sec * 1000);
      }
      if (!res.ok) {
        throw new SpotifyError(`Spotify could not answer (${res.status}).`, res.status >= 500 ? 502 : res.status);
      }
      return res.json();
    }
    throw new SpotifyError('Spotify sign-in expired. Try again.', 502);
  } finally {
    releaseSlot();
  }
}

// ----------------------------------------------------------------- cache

// Missing table (migration not run) or a database hiccup reads as a miss:
// the memory cache still works on its own.
async function l2Read(keys) {
  const rows = new Map();
  try {
    const { data, error } = await supabaseAdmin.from(CACHE_TABLE).select('key, payload, expires_at').in('key', keys);
    if (error) return rows;
    (data || []).forEach((r) => rows.set(r.key, { payload: r.payload, expiresAt: Date.parse(r.expires_at) }));
  } catch { /* miss */ }
  return rows;
}

async function l2Write(key, payload, ttlMs) {
  try {
    const now = Date.now();
    await supabaseAdmin.from(CACHE_TABLE).upsert({
      key,
      payload,
      expires_at: new Date(now + ttlMs).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
    // Now and then, drop rows too old to serve even as stale.
    if (Math.random() < 0.02) {
      await supabaseAdmin.from(CACHE_TABLE).delete().lt('updated_at', new Date(now - STALE_KEEP_MS).toISOString());
    }
  } catch { /* best effort */ }
}

const inFlight = new Map();

// Memory, then the shared table, then Spotify. When Spotify fails, an expired
// answer from the table is served instead (marked stale for a minute in
// memory, so a failing Spotify is not asked again on every request).
async function cachedSpotify(key, ttlMs, producer) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const now = Date.now();
    const rows = await l2Read([key, COOLDOWN_KEY]);
    const pause = rows.get(COOLDOWN_KEY);
    if (pause && pause.expiresAt > now) cooldownUntil = Math.max(cooldownUntil, Number(pause.payload?.until) || 0);

    const row = rows.get(key);
    if (row && row.expiresAt > now) {
      cacheSet(key, row.payload, row.expiresAt - now);
      return row.payload;
    }
    try {
      const value = await producer();
      cacheSet(key, value, ttlMs);
      await l2Write(key, value, ttlMs);
      return value;
    } catch (error) {
      if (row?.payload) {
        cacheSet(key, row.payload, 60 * 1000);
        return row.payload;
      }
      throw error;
    }
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------- tracks

function pickImage(images, minWidth) {
  const list = (images || []).filter((i) => i?.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (list.find((i) => (i.width || 0) >= minWidth) || list[list.length - 1])?.url || null;
}

function toTrack(t) {
  const images = t.album?.images;
  return {
    id: t.id,
    title: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    artistIds: (t.artists || []).map((a) => a.id).filter(Boolean),
    album: t.album?.name || '',
    albumId: t.album?.id || null,
    image: pickImage(images, 300),
    imageSmall: pickImage(images, 64),
    url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    durationMs: t.duration_ms || null,
    explicit: !!t.explicit,
  };
}

export const isSpotifyId = (id) => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id);

const normalizeQuery = (q) => String(q || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100);

// ------------------------------------------------------- Christian filter

// Artists the app always counts as Christian / worship. Lower case.
const CHRISTIAN_ARTISTS = new Set([
  'hillsong worship', 'hillsong united', 'hillsong young & free', 'hillsong en español', 'hillsong kids',
  'elevation worship', 'elevation rhythm', 'bethel music', 'jesus culture', 'maverick city music',
  'maverick city música', 'upperroom', 'passion', 'housefires', 'we the kingdom', 'vertical worship',
  'gateway worship', 'north point worship', 'red rocks worship', 'life.church worship', 'vineyard worship',
  'planetshakers', 'rend collective', 'all sons & daughters', 'leeland', 'cityalight', 'shane & shane',
  'sovereign grace music', 'keith & kristyn getty', 'the worship initiative', 'integrity\'s hosanna! music',
  'hosanna! music', 'maranatha! music', 'maranatha! praise band', 'victory worship', 'musikatha',
  'chris tomlin', 'phil wickham', 'lauren daigle', 'for king & country', 'casting crowns', 'mercyme',
  'matt redman', 'kari jobe', 'cody carnes', 'brandon lake', 'pat barrett', 'chandler moore', 'naomi raine',
  'tauren wells', 'anne wilson', 'cain', 'katy nichole', 'danny gokey', 'francesca battistelli',
  'jenn johnson', 'brian johnson', 'steffany gretzinger', 'amanda cook', 'kim walker-smith', 'sean feucht',
  'don moen', 'darlene zschech', 'paul baloche', 'israel houghton', 'israel & new breed', 'michael w. smith',
  'third day', 'newsboys', 'tenth avenue north', 'zach williams', 'crowder', 'david crowder band',
  'matthew west', 'jeremy camp', 'tobymac', 'matt maher', 'sidewalk prophets', 'big daddy weave',
  'building 429', 'aaron shust', 'skillet', 'lecrae', 'andy mineo', 'kb', 'for all seasons',
  'cece winans', 'bebe & cece winans', 'tasha cobbs leonard', 'kirk franklin', 'tamela mann',
  'william mcdowell', 'travis greene', 'jonathan mcreynolds', 'todd dulaney', 'sinach', 'mercy chinwo',
  'nathaniel bassey', 'marcos witt', 'evan craft', 'jesus image', 'gable price and friends', 'tribl',
  'sons of sunday', 'charity gayle', 'jeremy riddle', 'josh baldwin', 'ben fielding', 'brooke ligertwood',
  'taya', 'reuben morgan', 'matt crocker', 'isa fabregas', 'every nation music', 'papuri!', 'papuri singers',
  'lifeway worship',
  // Filipino (Tagalog / Bisaya)
  'victory band', 'papuri! singers', 'hangad', 'jun gamboa music', 'kolariah', 'inebreo', 'rhema',
  'faithmusic manila', 'hannah abogado', 'melan stamatelaky', 'genesis anne', 'deovincci dasig',
  'nikka abatayo', 'rommel guevara', 'mj flores tv', 'lumerski', 'believers melody', 'sons club',
]);

// Names that mark a worship act even when it is not on the list above
// ("Lifeway Worship", "PAPURI!", "Every Nation Music"...). Spotify no longer
// gives artist genres to apps like this one, so the name is what there is.
const CHRISTIAN_NAME = /worship|praise|gospel|hillsong|\bchurch\b|ministr|papuri|every nation|\bhymn|adoraci[oó]n|louvor|alabanza|\bpsalm|cathedral|parish|\bchoir\b/i;

// Words in a song or album title that make it a worship song, in English,
// Tagalog and Bisaya - so a Filipino worship song by a small local artist is
// found too. Only words hardly ever used outside church (not "God" or "Lord"
// alone: plenty of secular songs say those).
const CHRISTIAN_TITLE = new RegExp([
  // English
  // ("hymn", "gospel" and "praise" are left out: "Hymn for the Weekend",
  // "Praise You" and the like are not worship songs.)
  'jesus', 'christ', 'hallelujah', 'alleluia', 'hosanna', 'worship', 'holy spirit', 'savio(u)?r',
  'amazing grace', 'yahweh', 'jehovah', 'emmanuel', 'immanuel', 'messiah', 'lamb of god',
  // Tagalog
  'diyos', 'dios', 'panginoon', 'hesus', 'hesukristo', 'kristo', 'cristo', 'papuri', 'pupurihin', 'purihin',
  'sambahin', 'pagsamba', 'sumasamba', 'banal', 'espiritu', 'luwalhati', 'ama namin', 'kordero',
  // Bisaya
  'ginoo', 'dayeg', 'dayegon', 'daygon', 'pagdayeg', 'amahan', 'halad', 'ginoong hesus',
].map((w) => `\\b${w}\\b`).join('|'), 'i');

// Artists of songs already saved to the Song List count as trusted: an Admin
// chose them.
async function trustedArtistIds() {
  return cached('spotify:trusted-artists', 5 * 60 * 1000, async () => {
    try {
      const { data, error } = await supabaseAdmin.from('spotify_songs').select('artist_ids');
      if (error) return [];
      return [...new Set((data || []).flatMap((r) => r.artist_ids || []))];
    } catch { return []; }
  });
}
export const forgetTrustedArtists = () => cacheInvalidate('spotify:trusted-artists');

function isChristian(track, trusted) {
  if (track.explicit) return false;
  if (track.artistIds.some((id) => trusted.has(id))) return true;
  if (track.artists.toLowerCase().split(', ').some((n) => CHRISTIAN_ARTISTS.has(n) || CHRISTIAN_NAME.test(n))) return true;
  return CHRISTIAN_TITLE.test(track.title) || CHRISTIAN_TITLE.test(track.album || '');
}

// The cached page keeps every clean track; which ones are shown is decided
// on each read, so a song saved a minute ago makes its artist count at once.
async function onlyChristian(page) {
  const trusted = new Set(await trustedArtistIds());
  const items = page.tracks.filter((t) => isChristian(t, trusted));
  return { items, hidden: page.tracks.length - items.length, hasMore: page.hasMore };
}

async function searchPage(q, offset, ttl) {
  const key = `spotify:search:v2:${SPOTIFY_MARKET}:${offset}:${q}`;
  return cachedSpotify(key, ttl, async () => {
    const json = await spotifyGet('/search', { q, type: 'track', limit: SEARCH_PAGE, offset, market: SPOTIFY_MARKET });
    return {
      tracks: (json.tracks?.items || []).filter((t) => t?.id && !t.explicit).map(toTrack),
      hasMore: !!json.tracks?.next && offset + SEARCH_PAGE < MAX_OFFSET,
    };
  });
}

// GET /api/spotify?mode=search
// The filter can hide most of a page, so up to MAX_PAGES pages are read
// until there are enough songs to show. Each page is cached on its own, so a
// repeat costs nothing.
const MAX_PAGES = 3;
const ENOUGH = 6;

export async function searchChristianTracks(query, offset = 0) {
  const q = normalizeQuery(query);
  if (q.length < 2) return { items: [], hidden: 0, hasMore: false, nextOffset: 0 };
  let at = Math.min(MAX_OFFSET, Math.max(0, Math.floor(Number(offset) / SEARCH_PAGE) * SEARCH_PAGE || 0));
  const items = [];
  let hidden = 0;
  let hasMore = true;
  for (let page = 0; page < MAX_PAGES && hasMore && items.length < ENOUGH; page += 1) {
    let result;
    try {
      result = await onlyChristian(await searchPage(q, at, SEARCH_TTL));
    } catch (error) {
      if (!page) throw error;
      break; // keep what the first pages found
    }
    result.items.forEach((t) => { if (!items.some((x) => x.id === t.id)) items.push(t); });
    hidden += result.hidden;
    hasMore = result.hasMore;
    at += SEARCH_PAGE;
  }
  return { items, hidden, hasMore, nextOffset: at };
}

// GET /api/spotify?mode=album - the other songs on a song's album. The album
// of a song already in the list is trusted as a whole; only explicit songs
// are left out.
export async function getAlbum(albumId) {
  if (!isSpotifyId(albumId)) throw new SpotifyError('That is not a Spotify album.', 400);
  return cachedSpotify(`spotify:album:${SPOTIFY_MARKET}:${albumId}`, ALBUM_TTL, async () => {
    const json = await spotifyGet(`/albums/${albumId}`, { market: SPOTIFY_MARKET });
    return {
      id: json.id,
      name: json.name,
      artists: (json.artists || []).map((a) => a.name).join(', '),
      image: pickImage(json.images, 300),
      url: json.external_urls?.spotify || `https://open.spotify.com/album/${json.id}`,
      year: String(json.release_date || '').slice(0, 4),
      totalTracks: json.total_tracks || 0,
      tracks: (json.tracks?.items || [])
        .filter((t) => t?.id && !t.explicit)
        .map((t) => toTrack({ ...t, album: json })),
    };
  });
}

// --------------------------------------------------------- suggestions

const ROTATING_ARTISTS = [
  'Hillsong Worship', 'Elevation Worship', 'Bethel Music', 'Maverick City Music', 'Chris Tomlin',
  'Phil Wickham', 'Planetshakers', 'Don Moen', 'Passion', 'Jesus Culture', 'Brandon Lake',
  'CeCe Winans', 'Lauren Daigle', 'Housefires', 'We The Kingdom', 'Victory Worship',
];
// One classic hymn a day for the Hymns shelf (its many recordings).
const HYMNS = [
  'amazing grace', 'how great thou art', 'great is thy faithfulness', 'it is well with my soul',
  'holy holy holy', 'blessed assurance', 'what a friend we have in jesus', 'be thou my vision',
  'the old rugged cross', 'in christ alone', 'nothing but the blood', 'come thou fount',
];
const FILIPINO_ARTISTS = ['Victory Worship', 'Musikatha', 'PAPURI!', 'Hope Filipino Worship'];

// Shelves change every day (a different page or artist), and each costs one
// Spotify call a day however many people open the page. Every shelf goes
// through the same Christian filter as a search.
function shelvesFor(day) {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const page = (n % 5) * SEARCH_PAGE;
  const artist = ROTATING_ARTISTS[n % ROTATING_ARTISTS.length];
  const filipino = FILIPINO_ARTISTS[n % FILIPINO_ARTISTS.length];
  return [
    { key: 'worship', title: 'Worship Anthems', icon: 'fa-hands-praying', q: 'worship', offset: page },
    { key: 'artist', title: `Artist of the Day: ${artist}`, icon: 'fa-microphone-lines', q: `artist:"${artist.toLowerCase()}"`, offset: 0 },
    { key: 'tagalog', title: 'Tagalog Worship', icon: 'fa-earth-asia', q: 'tagalog worship', offset: page },
    { key: 'bisaya', title: 'Bisaya Worship', icon: 'fa-earth-asia', q: 'bisaya worship', offset: page },
    { key: 'filipino', title: `Filipino Artist: ${filipino}`, icon: 'fa-microphone', q: `artist:"${filipino.toLowerCase()}"`, offset: 0 },
    { key: 'praise', title: 'Praise', icon: 'fa-music', q: 'praise', offset: page },
    { key: 'hymns', title: 'Hymns', icon: 'fa-book-bible', q: HYMNS[n % HYMNS.length], offset: 0 },
    { key: 'gospel', title: 'Gospel', icon: 'fa-church', q: 'gospel', offset: page },
  ];
}

// GET /api/spotify?mode=suggestions
export async function christianSuggestions() {
  const day = new Date().toISOString().slice(0, 10);
  const shelves = await Promise.all(shelvesFor(day).map(async (shelf) => {
    try {
      const { items } = await onlyChristian(await searchPage(shelf.q, shelf.offset, SUGGESTION_TTL));
      return { key: shelf.key, title: shelf.title, icon: shelf.icon, items };
    } catch (error) {
      return { key: shelf.key, title: shelf.title, icon: shelf.icon, items: [], error: error.message };
    }
  }));
  return shelves.filter((s) => s.items.length || s.error);
}

// One track by id, for saving to the Song List - the server reads the
// details from Spotify rather than trusting what the browser sent.
export async function getTrack(id) {
  if (!isSpotifyId(id)) throw new SpotifyError('That is not a Spotify track.', 400);
  return cachedSpotify(`spotify:track:v2:${SPOTIFY_MARKET}:${id}`, TRACK_TTL, async () => {
    const json = await spotifyGet(`/tracks/${id}`, { market: SPOTIFY_MARKET });
    return toTrack(json);
  });
}
