// Service videos: Facebook videos of past services (the Online Midweek Service
// first of all), posted from Dashboard > Social Media, listed at /midweek
// (each at /midweek/<slug>) and opened on Facebook. What the browser and the
// server both need: the kinds of service, the thumbnail templates, slugs,
// reading a Facebook link, and the dates on the page.
//
// They open on Facebook rather than play on the website: a service video with
// worship songs in it is usually one Facebook will not let another website
// show ("may contain content owned by someone else"), but anyone can watch it
// on Facebook itself.

export const VIDEO_CATEGORIES = [
  { key: 'midweek', label: 'Midweek Service', day: 3 }, // Wednesday
  { key: 'sunday', label: 'Sunday Service', day: 0 },
  { key: 'special', label: 'Special Service', day: null },
];
export const DEFAULT_CATEGORY = 'midweek';

export const categoryLabel = (key) => (VIDEO_CATEGORIES.find((c) => c.key === key) || VIDEO_CATEGORIES[0]).label;
export const isCategory = (key) => VIDEO_CATEGORIES.some((c) => c.key === key);

// ---- Thumbnails: drawn from the service's own title, date and speaker by one
// of these templates (lib/midweekThumbnails) ----
export const THUMBNAIL_TEMPLATES = [
  { key: 'spotlight', name: 'Spotlight' },
  { key: 'calendar', name: 'Calendar' },
  { key: 'sanctuary', name: 'Sanctuary Light' },
  { key: 'bulletin', name: 'Bulletin' },
  { key: 'joyfulSound', name: 'Joyful Sound' },
];
export const DEFAULT_TEMPLATE = 'spotlight';
export const isThumbnailTemplate = (key) => THUMBNAIL_TEMPLATES.some((t) => t.key === key);

// ---- Slugs: /midweek/the-power-of-god ----
// Lowercase, accents and symbols gone, spaces to hyphens, no repeated hyphens.
// "God's" reads "gods", not "god-s". Kept to 80 characters.
export function slugify(text) {
  const slug = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents: "é" -> "e", "ñ" -> "n"
    .toLowerCase().trim()
    .replace(/['‘’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
  return slug || 'service';
}

export const midweekPath = (slug) => (slug ? `/midweek/${encodeURIComponent(slug)}` : '/midweek');

// The video /midweek opens with: the latest Midweek Service, or the latest of
// any kind when there is none. The list is newest first.
export const defaultVideo = (videos) => videos.find((v) => v.category === 'midweek') || videos[0] || null;

// ---- A Facebook link, from whatever the admin pasted ----
//
//   the video's link   https://www.facebook.com/<page>/videos/<id>/
//                      https://www.facebook.com/watch/?v=<id>
//                      https://www.facebook.com/reel/<id>
//   a share link       https://www.facebook.com/share/v/<code>/   https://fb.watch/<code>/
//   the post's link    https://www.facebook.com/<page>/posts/...
//   an embed code      <iframe src="https://www.facebook.com/plugins/video.php?href=...">
//
// gives { url, key } - the link, tidied (www.facebook.com, no tracking
// parameters), and what identifies the video, to notice the same one posted
// twice - or { error }.

const FB_HOST = /^(?:www\.|m\.|web\.|mbasic\.|business\.|l\.)?facebook\.com$/i;
const SHORT_HOST = /^(?:www\.)?fb\.watch$/i;
// The only query parameters a Facebook link needs; the rest is tracking.
const KEEP_PARAMS = ['v', 'story_fbid', 'id', 'fbid', 'set'];
export const LINK_HELP = 'On Facebook, open the video, click Share, then Copy link, and paste it here.';

export function parseFacebookLink(input, depth = 0) {
  let raw = String(input || '').trim();
  if (!raw) return { error: 'Paste the video\'s link from Facebook.' };
  const src = raw.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src) raw = src[1];
  raw = raw.replace(/&amp;/g, '&').trim();
  if (/^\/\//.test(raw)) raw = `https:${raw}`;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let u;
  try { u = new URL(raw); } catch { return { error: `That is not a Facebook link. ${LINK_HELP}` }; }

  if (SHORT_HOST.test(u.hostname)) {
    const code = u.pathname.replace(/\/+$/, '');
    if (code.length < 3) return { error: `This fb.watch link is not complete. ${LINK_HELP}` };
    return { url: `https://fb.watch${code}/`, key: `fb.watch${code}` };
  }
  if (!FB_HOST.test(u.hostname)) return { error: 'Only Facebook links can be added here.' };

  // Facebook's link shim (l.facebook.com/l.php?u=...) and the embed's plugin
  // address both carry the real link inside.
  const inner = /^\/l\.php$/i.test(u.pathname) ? u.searchParams.get('u')
    : /^\/(?:v[\d.]+\/)?plugins\/(?:video|post)\.php$/i.test(u.pathname) ? u.searchParams.get('href') : null;
  if (inner || /^\/(?:v[\d.]+\/)?plugins\//i.test(u.pathname) || /^\/l\.php$/i.test(u.pathname)) {
    if (!inner || depth > 0) return { error: 'This code has no video link in it. Copy the link again from Facebook.' };
    return parseFacebookLink(inner, depth + 1);
  }

  const path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!path || /^\/(?:home\.php|login|watch)$/i.test(path) && !u.searchParams.get('v')) {
    return { error: `This is not a link to one video. ${LINK_HELP}` };
  }
  // Just a page or profile ("facebook.com/CebuCityJoyfulSound"): not a video.
  if (/^\/[^/]+$/.test(path) && !/^\/(?:watch|video\.php|permalink\.php|story\.php|photo\.php)$/i.test(path)) {
    return { error: `This is the link to a Facebook page, not to one video. ${LINK_HELP}` };
  }

  const kept = new URLSearchParams();
  KEEP_PARAMS.forEach((k) => { const v = u.searchParams.get(k); if (v) kept.set(k, v); });
  const query = kept.toString();
  const url = `https://www.facebook.com${path}${/\.php$/i.test(path) || query ? '' : '/'}${query ? `?${query}` : ''}`;

  // The video's number, when the link has one; otherwise the tidied link.
  const id = u.searchParams.get('v') || path.match(/\/(?:videos|reel|reels)\/(?:[^/]+\/)?(\d{5,})$/i)?.[1] || null;
  return { url, key: id || url };
}

// ---- Dates ----

// Today in the Philippines, "YYYY-MM-DD".
export const phToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

// The latest `weekday` (0 Sunday ... 6 Saturday) on or before today, in the
// Philippines: the date a service video most likely belongs to.
export function lastWeekday(weekday) {
  if (weekday == null) return phToday();
  const [y, m, d] = phToday().split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const back = (day.getUTCDay() - weekday + 7) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

export const defaultDateFor = (category) => lastWeekday(VIDEO_CATEGORIES.find((c) => c.key === category)?.day ?? null);

// "2025-11-19" -> { weekday: 'Wednesday', short: 'Wed', month: 'Nov', day: '19', year: '2025', long: 'Wednesday, November 19, 2025', medium: 'Nov 19, 2025' }
export function serviceDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const f = (opts) => at.toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  return {
    weekday: f({ weekday: 'long' }),
    short: f({ weekday: 'short' }),
    month: f({ month: 'short' }),
    day: String(+m[3]),
    year: m[1],
    long: f({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    medium: f({ month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

