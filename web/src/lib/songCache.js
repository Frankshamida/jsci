// Keeps Song Playlist audio on the listener's device, so a song is fetched
// from Cloudinary once per device rather than once per play.
//
// The browser's own HTTP cache is no help here: audio is played with range
// requests, which it caches poorly or not at all. So the whole file is fetched
// once, stored in Cache Storage, and played from a blob: URL - including
// seeking - with no further requests.
//
// Kept to MAX_BYTES, oldest-played first out. Where Cache Storage is missing
// (an http:// LAN address, some private windows) this falls back to plain
// streaming, which still works, just without the saving.

const CACHE_NAME = 'jsci-song-playlist-v1';
const INDEX_KEY = 'jsci-song-cache-index-v1'; // { [url]: { size, usedAt } }
const MAX_BYTES = 300 * 1024 * 1024;           // ~80 songs at 96 kbps

export function songCacheSupported() {
  return typeof window !== 'undefined' && 'caches' in window && window.isSecureContext;
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || {}; } catch { return {}; }
}

function writeIndex(index) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* storage blocked */ }
}

export function cachedSongUrls() {
  return new Set(Object.keys(readIndex()));
}

async function evictOverflow(cache, keepUrl) {
  const index = readIndex();
  let total = Object.values(index).reduce((sum, e) => sum + (e.size || 0), 0);
  const oldestFirst = Object.entries(index)
    .filter(([url]) => url !== keepUrl)
    .sort(([, a], [, b]) => (a.usedAt || 0) - (b.usedAt || 0));
  for (const [url, entry] of oldestFirst) {
    if (total <= MAX_BYTES) break;
    try { await cache.delete(url); } catch { /* already gone */ }
    total -= entry.size || 0;
    delete index[url];
  }
  writeIndex(index);
}

// Drops songs that are no longer in the playlist.
export async function pruneSongCache(liveUrls) {
  if (!songCacheSupported()) return;
  const live = new Set(liveUrls);
  const index = readIndex();
  const stale = Object.keys(index).filter((url) => !live.has(url));
  if (!stale.length) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(stale.map((url) => cache.delete(url)));
  } catch { /* best effort */ }
  stale.forEach((url) => { delete index[url]; });
  writeIndex(index);
}

// Resolves to { src, fromCache }. `src` is a blob: URL the caller must revoke
// when done, or - on the fallback path - the plain stream URL.
export async function getSongSource(url, { signal, onProgress } = {}) {
  if (!songCacheSupported()) return { src: url, fromCache: false };

  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch { return { src: url, fromCache: false }; }

  const hit = await cache.match(url).catch(() => null);
  if (hit) {
    const blob = await hit.blob();
    const index = readIndex();
    index[url] = { size: blob.size, usedAt: Date.now() };
    writeIndex(index);
    return { src: URL.createObjectURL(blob), fromCache: true };
  }

  let res;
  try {
    res = await fetch(url, { signal, mode: 'cors' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Blocked (CORS, a filter): stream it the ordinary way instead.
    return { src: url, fromCache: false };
  }
  if (!res.ok) throw new Error(`Could not load the song (${res.status}).`);
  const type = res.headers.get('content-type') || 'audio/mpeg';
  const total = Number(res.headers.get('content-length')) || 0;

  let blob;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(Math.min(1, loaded / total));
    }
    blob = new Blob(chunks, { type });
  } else {
    blob = await res.blob();
  }

  try {
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } }));
    const index = readIndex();
    index[url] = { size: blob.size, usedAt: Date.now() };
    writeIndex(index);
    await evictOverflow(cache, url);
    // Ask the browser not to clear it under storage pressure. Harmless if refused.
    navigator.storage?.persist?.().catch(() => {});
  } catch { /* out of quota: still play it, just not saved */ }

  return { src: URL.createObjectURL(blob), fromCache: false };
}
