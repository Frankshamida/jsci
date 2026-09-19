// What a shared link looks like in Messenger, WhatsApp, Viber, X and the rest.
//
// Every one of them reads the same three Open Graph tags off the page - a
// title, a description and one image - and shows them as a card under whatever
// the sender typed. Until this file existed the app had no such tags, so every
// link anybody posted came back as the site logo and the words "Joyful Sound
// Church International", no matter which event it pointed at.
//
// The card an event link should give instead:
//
//     [ the event's own poster, 1200x630 ]
//     Cebu - Miracle Working God
//     Saturday, September 26, 2025 - Cebu City Sports Complex
//     sanctuaryhub.vercel.app
//
// Nothing here touches the browser or the database, so it is safe to import
// from a server component (where the tags are actually rendered) and from the
// client page alike.

import { evtDate } from '@/lib/eventWhen';
import { titleCaseEvent } from '@/lib/eventTitle';

export const SITE_NAME = 'Joyful Sound Church International';
export const SITE_TAGLINE = 'Ministry Portal - events, registration and live services';

// The card for every link that is not one event's own, and the stand-in for an
// event with no poster uploaded yet. It is a real 1200x630 file rather than the
// square logo, because a square handed to Facebook comes back as the postage
// stamp in the corner of the post - which is what a link to this site looked
// like before any of this existed. Regenerate it, keeping the size, if the
// branding changes; give it a new filename when you do, since Facebook caches
// a scraped image by its URL.
export const DEFAULT_CARD_IMAGE = '/assets/og-default.jpg';

// The one size every platform is happy with. Facebook and LinkedIn want at
// least 1200x630; X renders the same ratio for summary_large_image; WhatsApp
// and Viber crop the middle of whatever they are given. One landscape image
// that already IS that ratio is the only way to look the same in all of them.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// The site's own address, as an absolute origin. Set NEXT_PUBLIC_SITE_URL to
// the production domain - Open Graph images must be absolute URLs, and a
// crawler has no page to resolve a relative one against.
export const siteOrigin = () => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return String(explicit).trim().replace(/\/+$/, '');
  // Vercel sets these; the production one is preferred so a preview deploy
  // does not hand out preview URLs in cards people keep.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${String(vercel).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
};

// Anything relative ("/assets/LOGO.png") made absolute against the origin.
export const absoluteUrl = (value, origin = siteOrigin()) => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}/${url.replace(/^\/+/, '')}`;
};

// ---- The image -----------------------------------------------------------

// Event posters are portrait far more often than not - they are designed for a
// tarpaulin or an Instagram story. Handed to Facebook as-is, a portrait image
// is either shrunk into a small square beside the text or centre-cropped down
// to a band across the middle, which is how a poster loses its own title.
//
// Cloudinary (where every uploaded poster already lives) can reshape it in the
// URL, and the card is built in three passes:
//
//   1. the poster cropped to fill 1200x630 ...
//   2. ... blurred, which makes a backdrop in the poster's own colours
//   3. the whole poster laid on top at `c_fit`, so nothing is cut off
//
// The result reads as one designed image rather than a photo on a grey slab.
// `f_jpg` is deliberate: JPEG is the one format every chat app will render,
// where WebP and AVIF are still a coin toss.
const CLOUDINARY_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i;

// How much of the card the poster itself takes up, leaving a margin of backdrop.
const POSTER_W = 1060;
const POSTER_H = 560;

const layeredTransform = (publicId) => [
  `c_fill,w_${OG_WIDTH},h_${OG_HEIGHT},g_center`,
  'e_blur:1500,q_auto:eco',
  `l_${publicId},c_fit,w_${POSTER_W},h_${POSTER_H}`,
  'fl_layer_apply',
  'f_jpg,q_auto:good',
].join('/');

// The plain version, for a poster whose public ID cannot be named safely in a
// layer parameter: the whole image on a band of its own predominant colour.
// Not as handsome, still the right shape and still uncropped.
const PADDED_TRANSFORM = `c_pad,w_${OG_WIDTH},h_${OG_HEIGHT},b_auto:predominant,f_jpg,q_auto:good`;

// The asset's public ID, read back out of its delivery URL: everything after
// the version stamp, without the file extension. Returns '' when the URL is not
// shaped the way an upload is, rather than guessing.
const publicIdFrom = (pathPart) => {
  const segments = String(pathPart).split('/').filter(Boolean);
  const versionAt = segments.findIndex((s) => /^v\d+$/.test(s));
  const idParts = versionAt >= 0 ? segments.slice(versionAt + 1) : segments;
  if (idParts.length === 0) return '';
  const id = idParts.join('/').replace(/\.[^/.]+$/, '');
  // A layer parameter is comma- and slash-delimited itself, so only an ID made
  // of plain path characters can go into one unescaped. Uploads are sanitised
  // to exactly this set (see lib/cloudinary.js), so anything else is a URL from
  // somewhere we did not put it.
  return /^[A-Za-z0-9_\-/]+$/.test(id) ? id.replace(/\//g, ':') : '';
};

export const socialCardImage = (imageUrl, origin = siteOrigin()) => {
  const url = absoluteUrl(imageUrl, origin);
  if (!url) return '';
  const parts = url.match(CLOUDINARY_UPLOAD);
  // Not a Cloudinary asset (an image pasted in by hand, or a local file): it
  // still goes on the card, just at whatever shape it was.
  if (!parts) return url;
  const [, base, rest] = parts;
  const publicId = publicIdFrom(rest);
  return `${base}${publicId ? layeredTransform(publicId) : PADDED_TRANSFORM}/${rest}`;
};

// ---- The words -----------------------------------------------------------

// The place an event is known by, matching the slug its link is built from:
// "Cebu City" is the town everybody calls Cebu, and the link already says so.
const placeLabel = (evt) => String(evt?.loc_city || evt?.loc_province || evt?.loc_region || '')
  .trim()
  .replace(/\s+city$/i, '');

// "Cebu - Miracle Working God". The place leads because a card is skimmed in a
// crowded chat, and the first thing somebody decides is whether it is near
// enough to go to. An event with no place recorded is just its own name.
export const eventCardTitle = (evt) => {
  const title = titleCaseEvent(String(evt?.title || '').trim());
  if (!title) return SITE_NAME;
  const place = placeLabel(evt);
  return place ? `${place} - ${title}` : title;
};

// "September 26, 2025", or "September 26 - 28, 2025" across days. Short on
// purpose: the description line is truncated by every platform, and the date
// must survive that truncation.
//
// The pieces are assembled by hand rather than by asking toLocaleDateString for
// a partial set of fields. Given { day, year } and no month it answers
// "2026 (day: 3)" - a literal, correct reading of an incomplete request, and
// nothing anybody wants to read on a poster link.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const fullDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

const cardWhen = (evt) => {
  const start = evtDate(evt?.event_date);
  if (!start) return '';
  const end = evtDate(evt?.end_date);
  if (!end) return fullDate(start);

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const sameDay = sameMonth && start.getDate() === end.getDate();

  if (sameDay) return fullDate(start);
  // "October 2 - 4, 2026"
  if (sameMonth) return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${end.getFullYear()}`;
  // "October 30 - November 1, 2026"
  if (sameYear) return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  // "December 30, 2026 - January 2, 2027"
  return `${fullDate(start)} - ${fullDate(end)}`;
};

// Where it is held, as one readable phrase - the venue first, then the town,
// with the town dropped when the venue already names it.
const cardWhere = (evt) => {
  const venue = String(evt?.location || '').trim();
  const place = String(evt?.loc_city || evt?.loc_province || evt?.loc_region || '').trim();
  if (venue && place && !venue.toLowerCase().includes(place.toLowerCase())) return `${venue}, ${place}`;
  return venue || place;
};

const MAX_DESCRIPTION = 200;

const clamp = (text, limit = MAX_DESCRIPTION) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  // Cut on a word so the card never ends mid-syllable.
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:-]+$/, '')}…`;
};

// When and where, and then as much of the event's own blurb as still fits.
export const eventCardDescription = (evt) => {
  const facts = [cardWhen(evt), cardWhere(evt)].filter(Boolean).join(' - ');
  const blurb = String(evt?.description || '').replace(/\s+/g, ' ').trim();
  if (facts && blurb) return clamp(`${facts} - ${blurb}`);
  if (facts) return clamp(`${facts} - Register now at ${SITE_NAME}.`);
  if (blurb) return clamp(blurb);
  return `An event at ${SITE_NAME}. Tap to see the details and register.`;
};

// ---- The whole card ------------------------------------------------------

// The Next.js `metadata` object for an event's link. `url` is the magic link
// itself (see lib/eventSlug.js), which the card prints as its source and which
// Facebook uses to key its scrape cache.
export const eventCardMetadata = (evt, url, origin = siteOrigin()) => {
  const title = eventCardTitle(evt);
  const description = eventCardDescription(evt);
  const poster = socialCardImage(evt?.image_url, origin);
  const image = poster || absoluteUrl(DEFAULT_CARD_IMAGE, origin);
  // The dimensions are only declared when we know them: a Cloudinary poster is
  // reshaped to exactly 1200x630 above, and the fallback card is drawn at that
  // size. An image pasted in from somewhere else is any shape at all, and a
  // wrong width tells Facebook to lay out a space the picture will not fill.
  const sized = !poster || poster !== absoluteUrl(evt?.image_url, origin);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url,
      title,
      description,
      images: [{
        url: image,
        ...(sized ? { width: OG_WIDTH, height: OG_HEIGHT, type: 'image/jpeg' } : {}),
        alt: title,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
};
