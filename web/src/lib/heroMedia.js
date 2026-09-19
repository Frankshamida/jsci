/* ============================================================
   What the public hero shows: the photo carousel, or a video.

   The carousel is the original and stays the default - an event with no
   opinion about this, and a site whose setting has never been saved, both get
   exactly what they got before. Choosing "video" swaps the five stacked photos
   for one looping clip, and because a clip cut for a widescreen monitor is the
   wrong shape on a phone held upright, desktop and mobile are chosen
   separately.

   The setting lives in `system_settings` under the key below. This file is the
   one place that knows its shape, so the admin form, the API and the public
   page cannot drift from each other.

   Pure functions only - imported by a client component and by the server.
   ============================================================ */

export const HERO_MEDIA_KEY = 'hero_media';

// Where the clips live. A real folder under /public rather than an upload:
// these are served straight off the CDN as static files, with no function and
// no database in the way, which is the cheapest a video can possibly be.
export const HERO_VIDEO_DIR = 'Videos';

export const HERO_MODES = ['carousel', 'video'];

// A site that has never saved the setting. Carousel, as it always was.
export const HERO_MEDIA_DEFAULT = Object.freeze({
  mode: 'carousel',
  desktop: '',
  mobile: '',
});

// A filename is only ever a plain file sitting in that one folder. Anything
// with a slash, a backslash or a `..` in it is refused rather than cleaned up:
// this string is pasted into a URL and, on the admin side, compared against a
// directory listing, and "sanitising" a hostile path is how you end up serving
// something you did not mean to.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(mp4|webm|ogv)$/i;

export const isSafeVideoName = (name) => SAFE_NAME.test(String(name || '').trim());

// The public URL for a clip, or '' when the name is not one we will serve.
export const heroVideoUrl = (name) => (isSafeVideoName(name)
  ? `/${HERO_VIDEO_DIR}/${String(name).trim().split('/').pop()}`
  : '');

// ---- How heavy a hero loop may be -------------------------------------
//
// These are the numbers behind the warning in the admin form, and they are the
// difference between a hero that feels instant and one that does not. A
// background loop is decorative: it is muted, it has no detail anybody studies,
// and it is usually behind a dark scrim - so it survives compression that would
// ruin a film. Three or four megabytes buys a 10-15 second 1080p loop at a
// quality nobody will question. Fifty megabytes buys the same loop and several
// seconds of blank hero on a phone, every visit.
export const HERO_VIDEO_GOOD_BYTES = 6 * 1024 * 1024;   // fine
export const HERO_VIDEO_HEAVY_BYTES = 12 * 1024 * 1024; // will be felt on mobile data

// 'good' | 'heavy' | 'huge' - or '' when there is no file to judge.
export const heroVideoWeight = (bytes) => {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n <= HERO_VIDEO_GOOD_BYTES) return 'good';
  if (n <= HERO_VIDEO_HEAVY_BYTES) return 'heavy';
  return 'huge';
};

// Read whatever is in the database back into the shape above.
//
// It is forgiving on purpose. `system_settings.value` is JSONB, and the
// existing admin endpoint writes through `JSON.stringify`, so a value can come
// back as an object OR as a string holding one, depending on which door it
// went in by. Rather than migrate the rows, both are accepted here.
export const normalizeHeroMedia = (raw) => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { ...HERO_MEDIA_DEFAULT };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...HERO_MEDIA_DEFAULT };

  const mode = HERO_MODES.includes(value.mode) ? value.mode : HERO_MEDIA_DEFAULT.mode;
  const desktop = isSafeVideoName(value.desktop) ? String(value.desktop).trim() : '';
  const mobile = isSafeVideoName(value.mobile) ? String(value.mobile).trim() : '';

  // Video mode with nothing to play is not video mode. Falling back here rather
  // than at the point of rendering means the public page never has to reason
  // about a half-configured hero - and an admin who picks "video", saves, and
  // has not chosen a file yet still sees the carousel instead of a black box.
  if (mode === 'video' && !desktop && !mobile) return { ...HERO_MEDIA_DEFAULT };

  return { mode, desktop, mobile };
};

// Which clip a given viewport plays. Either one stands in for the other when
// only one has been chosen, so setting just a desktop clip is a valid way to
// say "this one everywhere".
export const heroVideoFor = (media, isMobile) => {
  const m = normalizeHeroMedia(media);
  if (m.mode !== 'video') return '';
  const wanted = isMobile ? (m.mobile || m.desktop) : (m.desktop || m.mobile);
  return heroVideoUrl(wanted);
};
