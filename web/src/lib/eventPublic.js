// The public event page an attendee's ID opens:
//
//   /events/cebu-miracle-working-god              programme (the default view)
//   /events/cebu-miracle-working-god/programme    programme
//   /events/cebu-miracle-working-god/photos       event photos, behind a password or RFID
//
// The slug is the province followed by the event's name - the order people
// say it at the door ("the Cebu one") - and, like the registration links in
// eventSlug.js, it is DERIVED from the event rather than stored.
//
// Safe to import in the browser: nothing here needs a secret. The signing of
// photo access lives in eventAccess.js, server side.

import { slugify } from '@/lib/eventSlug';

// The place in the slug: the province, else the city, else the region, with a
// trailing "City" dropped so "Cebu City" reads as "cebu".
const placeOf = (evt) => String(evt?.loc_province || evt?.loc_city || evt?.loc_region || '')
  .trim().replace(/\s+city$/i, '');

/** The place as printed after the name: "Miracle Working God - Cebu". */
export const placeName = (evt) => String(evt?.loc_province || evt?.loc_city || evt?.loc_region || '').trim();

/** "Miracle Working God - Cebu". */
export const publicEventTitle = (evt) => [String(evt?.title || '').trim(), placeName(evt)].filter(Boolean).join(' - ');

const titlePart = (evt) => slugify(evt?.title).replace(/-events?$/, '');

const yearOf = (evt) => (String(evt?.event_date || '').match(/^(\d{4})/) || [])[1] || '';

/** "cebu-miracle-working-god" - '' for an event with no usable title. */
export const publicEventSlug = (evt) => {
  const title = titlePart(evt);
  if (!title) return '';
  return [slugify(placeOf(evt)), title].filter(Boolean).join('-');
};

/**
 * The slug to hand out, judged against every other event: the year is added
 * only when another event already answers to the same place and name (the
 * same conference, back in Cebu next year).
 */
export const publicEventSlugFor = (evt, allEvents = []) => {
  const base = publicEventSlug(evt);
  if (!base) return '';
  const clash = (allEvents || []).some((o) => o && o.id !== evt?.id && publicEventSlug(o) === base);
  const year = yearOf(evt);
  return clash && year ? `${base}-${year}` : base;
};

const dayMs = (evt) => {
  const m = String(evt?.event_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
};

// Several events on one slug: the next one coming up, else the latest.
const nearest = (matches) => {
  if (matches.length <= 1) return matches[0] || null;
  const cutoff = Date.now() - 7 * 86400000;
  const ahead = matches.filter((e) => dayMs(e) >= cutoff).sort((a, b) => dayMs(a) - dayMs(b));
  return ahead[0] || [...matches].sort((a, b) => dayMs(b) - dayMs(a))[0];
};

/** Which event a public slug points at, or null. */
export const findEventByPublicSlug = (events, slug) => {
  const wanted = slugify(slug);
  if (!wanted) return null;
  const list = (events || []).filter(Boolean);

  const exact = list.filter((e) => publicEventSlug(e) === wanted);
  if (exact.length) return nearest(exact);

  const withYear = wanted.match(/^(.*)-(\d{4})$/);
  if (withYear) {
    const dated = list.filter((e) => publicEventSlug(e) === withYear[1] && yearOf(e) === withYear[2]);
    if (dated.length) return nearest(dated);
  }

  // The province changed (or was never set) since the ID was printed: match on
  // the name at the end of the slug, so a card already in somebody's hand
  // still opens.
  const byTitle = list.filter((e) => {
    const t = titlePart(e);
    return t && (wanted === t || wanted.endsWith(`-${t}`));
  });
  return byTitle.length ? nearest(byTitle) : null;
};

/**
 * What the ID's QR holds: the event page, with the attendee's own code, so
 * the page can greet them and the photo unlock is checked against them.
 */
export const attendeePageUrl = (origin, slug, publicCode) => {
  const base = `${String(origin || '').replace(/\/+$/, '')}/events/${slug}`;
  return publicCode ? `${base}?t=${encodeURIComponent(publicCode)}` : base;
};

// ---- The photo password: LASTNAME@2026 ----

const SUFFIX = /\b(JR|SR|II|III|IV|V)\.?$/;
// Upper-case, accents off, only letters/digits/@ kept - so "DELA CRUZ@2026"
// and "DELACRUZ@2026" are the same password, and so is "PEÑA" / "PENA".
const passwordKey = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9@]/g, '');

/** The last name a registration is known by. */
export const lastNameOf = (reg) => {
  const last = String(reg?.attendee_lastname || '').trim();
  if (last) return last;
  const whole = String(reg?.attendee_name || '').trim().split(/\s+/);
  return whole.length > 1 ? whole[whole.length - 1] : (whole[0] || '');
};

/** The year in the password - the year the event is held. */
export const passwordYear = (evt) => yearOf(evt) || String(new Date().getFullYear());

/** e.g. "GOMEZ@2026". */
export const photoPasswordFor = (reg, evt) => `${String(lastNameOf(reg)).toUpperCase()}@${passwordYear(evt)}`;

/** The first name a registration is known by. */
export const firstNameOf = (reg) => {
  const first = String(reg?.attendee_firstname || '').trim();
  if (first) return first;
  const whole = String(reg?.attendee_name || '').trim().split(/\s+/);
  return whole.length > 1 ? whole.slice(0, -1).join(' ') : '';
};

// How many letters of the first name go in front when a last name is shared.
export const FIRST_LETTERS = 4;

/**
 * Which form of the password `typed` is for `reg`, or null:
 *   'last'   DELACRUZ@2026     the usual one
 *   'first4' JUANDELACRUZ@2026 first 4 letters of the first name (all of it
 *                              when shorter: AL, JOY) + last name, for when
 *                              several attendees share a last name
 *   'full'   JUANITODELACRUZ@2026 the whole first name (or its first word),
 *                              for when even the first 4 letters are shared
 * Typed in capitals, as printed; spaces, dots and a Jr./Sr. are forgiven.
 */
export const passwordMatchKind = (typed, reg, evt) => {
  const raw = String(typed || '').trim();
  if (!raw || raw !== raw.toUpperCase()) return null;
  const got = passwordKey(raw);
  const year = passwordYear(evt);
  const last = String(lastNameOf(reg)).toUpperCase().trim();
  const lasts = [...new Set([last, last.replace(SUFFIX, '').trim()].filter(Boolean))];
  // Letters only. A first name of 2 or 3 letters (Al, Joy) is used whole -
  // it is its own "first 4 letters".
  const first = passwordKey(firstNameOf(reg)).replace(/[^A-Z]/g, '');
  // "Ma. Teresa" / "Juan Carlos": the first word alone also counts as whole.
  const firstWord = passwordKey(String(firstNameOf(reg)).split(/[\s.]+/).filter(Boolean)[0] || '').replace(/[^A-Z]/g, '');
  const is = (prefix) => lasts.some((l) => passwordKey(`${prefix}${l}@${year}`) === got);
  if (is('')) return 'last';
  if (first && is(first.slice(0, FIRST_LETTERS))) return 'first4';
  if (first && first.length > FIRST_LETTERS && is(first)) return 'full';
  if (firstWord && firstWord.length > FIRST_LETTERS && firstWord !== first && is(firstWord)) return 'full';
  return null;
};

/** Does `typed` open the photos for `reg`, in any of its forms? */
export const passwordMatches = (typed, reg, evt) => !!passwordMatchKind(typed, reg, evt);

// ---- The programme ----

export const PROGRAMME_KINDS = [
  { key: 'session', label: 'Session', icon: 'fa-microphone-lines' },
  { key: 'worship', label: 'Worship', icon: 'fa-music' },
  { key: 'registration', label: 'Registration', icon: 'fa-clipboard-check' },
  { key: 'meal', label: 'Meal', icon: 'fa-utensils' },
  { key: 'break', label: 'Break', icon: 'fa-mug-hot' },
  { key: 'other', label: 'Other', icon: 'fa-circle-dot' },
];
export const programmeKind = (key) => PROGRAMME_KINDS.find((k) => k.key === key) || PROGRAMME_KINDS[0];

/** "13:30:00" -> "1:30 PM". */
export const formatClock = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "2026-10-02" -> "Friday, October 2, 2026". */
export const formatDay = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
};

/** Programme rows grouped by day, each day in time order. */
export const groupProgramme = (items) => {
  const days = new Map();
  [...(items || [])]
    .sort((a, b) => `${a.day_date} ${a.start_time}`.localeCompare(`${b.day_date} ${b.start_time}`))
    .forEach((it) => {
      if (!days.has(it.day_date)) days.set(it.day_date, []);
      days.get(it.day_date).push(it);
    });
  return [...days.entries()].map(([day, rows]) => ({ day, rows }));
};

// ---- The event's days ----

const isoDay = (v) => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';

/**
 * Every day the event runs, first to last: ['2026-10-02', '2026-10-03'].
 * A one-day event (or one with no end date) is a single day. Capped at 31 so
 * a mistyped end year cannot make a tab strip a year long.
 */
export const eventDays = (evt) => {
  const first = isoDay(evt?.event_date);
  if (!first) return [];
  const last = isoDay(evt?.end_date);
  const [y, m, d] = first.split('-').map(Number);
  const days = [];
  for (let i = 0; i < 31; i += 1) {
    const dt = new Date(y, m - 1, d + i);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    days.push(iso);
    if (!last || iso >= last) break;
  }
  return days;
};

/**
 * The event's days plus any other day something is dated on (a programme item
 * saved before the dates changed), in order - so nothing drops out of view.
 */
export const daysWith = (evt, extra = []) => [...new Set([...eventDays(evt), ...extra.map(isoDay).filter(Boolean)])].sort();

// ---- Feedback ----
// Counted the same way on the page (the live "123 / 500 words") and on the
// server (which refuses anything over), so the two can never disagree.
export const FEEDBACK_MAX_WORDS = 500;
export const FEEDBACK_MAX_NAME = 80;
export const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/** "2026-10-02" -> "Fri, Oct 2". */
export const shortDay = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
