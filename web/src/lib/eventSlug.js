// Public "magic links" for event registration.
//
// Every published event answers to a link made of the two things people
// already know it by - its name and the place it is held:
//
//   "Miracle Working God" in Cebu  ->  /miracle-working-god-cebu-event
//
// Opening one lands on the home page with that event's registration already
// up, so somebody who taps a link in a group chat starts filling in the form
// instead of hunting for the poster.
//
// The slug is DERIVED from the event, never stored, which means renaming an
// event renames its link. `findEventBySlug` softens that: it falls back to
// matching on the title alone, so a link still works after the venue moves.

// Lower-cased, accent-free, hyphen-joined. Apostrophes are dropped rather
// than turned into separators, so "God's" reads as "gods", not "god-s".
export const slugify = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/['‘’ʼ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// The place the event is known by - the same city/province/region the home
// page prints on the card pill, with a redundant "City" suffix dropped so
// Cebu City reads as "cebu".
const placeOf = (evt) => String(evt?.loc_city || evt?.loc_province || evt?.loc_region || '')
  .trim().replace(/\s+city$/i, '');

// The title with a trailing "Event"/"Events" removed, so an event actually
// named "Miracle Working God Event" does not become "...-event-cebu-event".
const titlePart = (evt) => slugify(evt?.title).replace(/-events?$/, '');

// The year an event falls on, as a string - only ever appended to break a tie
// between two events of the same name in the same place. See `eventSlugFor`.
const yearOf = (evt) => (String(evt?.event_date || '').match(/^(\d{4})/) || [])[1] || '';

// Sortable stamp for an event's day. Only used to choose between events that
// share a link, so the date alone is enough - the time of day never decides it.
const dayMs = (evt) => {
  const m = String(evt?.event_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
};

// An event's link, without the leading slash: "miracle-working-god-cebu-event".
// Empty for an event with no usable title - a draft with no name has no link
// to give out yet.
export const eventSlug = (evt) => {
  const title = titlePart(evt);
  if (!title) return '';
  return [title, slugify(placeOf(evt)), 'event'].filter(Boolean).join('-');
};

// The link to actually hand out for `evt`, judged against everything else on
// the books: the plain slug when it is the only event of its name and place,
// and the year appended when it is not (an annual conference that comes back
// to the same city). `findEventBySlug` understands both forms.
export const eventSlugFor = (evt, allEvents = []) => {
  const base = eventSlug(evt);
  if (!base) return '';
  const clash = (allEvents || []).some((other) => other && other.id !== evt?.id && eventSlug(other) === base);
  const year = yearOf(evt);
  return clash && year ? `${base}-${year}` : base;
};

// A URL path read back as a candidate slug, or '' when it is not one of ours
// to resolve: the home page itself, anything nested, anything with a dot in
// it. Mirrors the single-segment pattern next.config.mjs rewrites, and
// lower-cases what it finds - links get retyped by hand, and a capital in one
// should not decide whether it opens.
export const slugFromPath = (pathname) => {
  const clean = String(pathname || '').split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  if (!clean || clean.includes('/')) return '';
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(clean) ? clean.toLowerCase() : '';
};

// Of several events answering to the same link, the one somebody following it
// most likely means: the next one coming up, or - if they have all been and
// gone - the most recent. Yesterday still counts as upcoming, because a link
// shared for a multi-day event should not jump to next year's halfway through.
const nearest = (matches) => {
  if (matches.length <= 1) return matches[0] || null;
  const cutoff = Date.now() - 86400000;
  const ahead = matches.filter((e) => dayMs(e) >= cutoff).sort((a, b) => dayMs(a) - dayMs(b));
  if (ahead.length > 0) return ahead[0];
  return [...matches].sort((a, b) => dayMs(b) - dayMs(a))[0];
};

// Which event a link points at, or null. Tried in order of confidence:
// the exact slug, the year-suffixed form, then the title on its own so a link
// printed on a tarpaulin survives the venue changing.
export const findEventBySlug = (events, slug) => {
  const wanted = slugFromPath(slug) || slugify(slug);
  if (!wanted) return null;
  const list = (events || []).filter(Boolean);

  const exact = list.filter((e) => eventSlug(e) === wanted);
  if (exact.length > 0) return nearest(exact);

  const withYear = wanted.match(/^(.*)-(\d{4})$/);
  if (withYear) {
    const dated = list.filter((e) => eventSlug(e) === withYear[1] && yearOf(e) === withYear[2]);
    if (dated.length > 0) return nearest(dated);
  }

  // "miracle-working-god-cebu-event" -> "miracle-working-god-cebu", which is
  // the title plus whatever place it had when the link was made. Matching on
  // the title prefix lets the place have changed, or gone.
  const stem = wanted.replace(/-event(-\d{4})?$/, '');
  const byTitle = list.filter((e) => {
    const t = titlePart(e);
    return t && (stem === t || stem.startsWith(`${t}-`));
  });
  return byTitle.length > 0 ? nearest(byTitle) : null;
};

// The full shareable URL, given the origin ("https://sanctuaryhub.vercel.app").
export const eventShareUrl = (evt, allEvents = [], origin = '') => {
  const slug = eventSlugFor(evt, allEvents);
  return slug ? `${String(origin).replace(/\/+$/, '')}/${slug}` : '';
};
