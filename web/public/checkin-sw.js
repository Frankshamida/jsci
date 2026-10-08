/* The Check-in Display app's service worker - scope /rfid-chekin-display only.

   What it keeps on the device, so the installed app opens at once and the
   screen keeps working through a Wi-Fi drop (the desk on the same computer
   reaches it without the internet at all):

     the screen itself          network first, the last copy when offline
     the app's code (/_next)    kept once fetched - every file is versioned
     the ID template, the logo,
     the fonts, the poster      kept once fetched, refreshed in the background

   Everything else - the database, the live link to the desk - is never
   touched: it goes straight to the network as if this file did not exist. */

const VERSION = 'checkin-app-v1';
const SHELL = '/rfid-chekin-display';
const PRECACHE = [
  SHELL,
  '/id_template/Front_ID_Template.png',
  '/assets/LOGO.png',
  '/app-icons/checkin-192.png',
  '/app-icons/checkin-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('checkin-app-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Kept once fetched; asked again in the background so a change still arrives.
async function keptFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

// The network first; the last copy when there is none.
async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(SHELL, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match(SHELL)) || (await cache.match(request)) || Response.error();
  }
}

const KEEP_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'res.cloudinary.com'];
const KEEP_PATHS = ['/_next/static/', '/id_template/', '/assets/', '/app-icons/'];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    if (url.origin === self.location.origin && url.pathname.startsWith(SHELL)) event.respondWith(networkFirst(request));
    return;
  }
  const keep = url.origin === self.location.origin
    ? KEEP_PATHS.some((p) => url.pathname.startsWith(p))
    : KEEP_HOSTS.includes(url.hostname);
  if (keep) event.respondWith(keptFirst(request));
  // Anything else (the database, the live link) is left alone.
});
