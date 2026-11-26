// The Sunday Service: the church's Facebook Live on Sunday mornings (the
// live_streams table), posted from Dashboard > Social Media > Sunday Service,
// shown at /sunday-service (each one at /sunday-service/<slug>) and played on
// the page for anyone signed in. What the browser and the server both need:
// addresses, dates, and reading what the admin pasted.
//
// Unlike a Midweek Service video, a Sunday Service plays right on the page:
// it is the church's own live, posted with Facebook's Embed code.

import { lastWeekday, parseFacebookLink, slugify } from '@/lib/serviceVideos';

export const SUNDAY_LABEL = 'Sunday Service';
export const SUNDAY_TIME = '9:00 AM';

export const sundayPath = (slug) => (slug ? `/sunday-service/${encodeURIComponent(slug)}` : '/sunday-service');

// The latest Sunday on or before today, in the Philippines.
export const defaultSundayDate = () => lastWeekday(0);

// ---- Slugs ----
// A Sunday Service is usually just called "Sunday Service", week after week,
// so its address is its date: /sunday-service/2026-11-29. A service with a
// title of its own gets that title, as a Midweek Service does:
// /sunday-service/faith-over-fear.
const PLAIN_TITLES = new Set([
  'sunday', 'sunday-service', 'sunday-service-live', 'sunday-live', 'sunday-worship', 'sunday-worship-service',
  'live', 'live-service', 'service', 'worship-service', 'sunday-celebration-service',
]);
export function sundaySlugBase(title, date) {
  const s = slugify(title);
  return PLAIN_TITLES.has(s) && date ? date : s;
}

// ---- What the website shows of a stream ----

export const streamTitle = (s) => String(s?.title || s?.caption || '').trim() || SUNDAY_LABEL;

// Its date: the service date, or the day it was posted (Philippine time) for
// one posted before streams had a date.
export function streamDate(s) {
  if (s?.service_date) return String(s.service_date).slice(0, 10);
  if (!s?.created_at) return null;
  const at = new Date(s.created_at);
  return Number.isNaN(at.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(at);
}

// The service /sunday-service opens with: the one live now, else the latest.
export const defaultStream = (list) => list.find((s) => s.is_live) || list[0] || null;

// ---- The player, from what the admin pasted ----
//
//   Facebook's Embed code   <iframe src="https://www.facebook.com/plugins/video.php?href=...">
//   the player's address    https://www.facebook.com/plugins/video.php?href=...
//   the video's own link    https://www.facebook.com/<page>/videos/<id>/
//
// gives { src, link, key } - the player's address, the video on Facebook, and
// what identifies the video (to notice it posted twice) - or { error }.
const PLAYER = /^https:\/\/(?:www\.|web\.|m\.)?facebook\.com\/(?:v[\d.]+\/)?plugins\/video\.php\?/i;
export const EMBED_HELP = 'On Facebook, open the live video, click ⋯ (More), then Embed, and copy the code.';

export function parseLiveEmbed(input) {
  let raw = String(input || '').trim();
  if (!raw) return { error: 'Paste the Facebook Live link or its Embed code.' };
  const src = raw.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src) raw = src[1];
  raw = raw.replace(/&amp;/g, '&').trim();
  if (/^\/\//.test(raw)) raw = `https:${raw}`;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  raw = raw.replace(/^http:/i, 'https:');

  const video = parseFacebookLink(raw); // reads the link inside a player's address too
  if (video.error) return { error: video.error };

  // Facebook's own player address, as its Embed code gives it: kept as it is.
  if (PLAYER.test(raw)) return { src: raw, link: video.url, key: video.key };

  // A share link names no video the player can open.
  if (/^https:\/\/fb\.watch\//i.test(video.url) || /facebook\.com\/share\//i.test(video.url)) {
    return { error: `A share link cannot play on the website. ${EMBED_HELP}` };
  }
  // The video's own link: the player Facebook's Embed code would give.
  return {
    src: `https://www.facebook.com/plugins/video.php?height=314&href=${encodeURIComponent(video.url)}&show_text=false&width=560&t=0`,
    link: video.url,
    key: video.key,
  };
}
