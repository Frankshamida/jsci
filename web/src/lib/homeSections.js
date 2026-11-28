// ============================================================
// Homepage sections a Super Admin can hide (System Configuration >
// Homepage Sections). Saved in system_settings under `homepage_sections`
// as { hidden: ['isom', ...] }; read on the server by the root layout
// (lib/homeSectionsServer.js), so a hidden section is never drawn, not even
// for a moment, and the menu and footers drop their links to it.
//
// The hero, the footer and "About SanctuaryHub" are not in the list: the hero
// is the page, the footer is how people get anywhere, and Google checks the
// About SanctuaryHub text for the sign-in app.
// Pure data and functions - safe on the server and in the browser.
// ============================================================

export const HOME_SECTIONS_KEY = 'homepage_sections';
export const HOME_SECTIONS_TAG = 'homepage-sections';

/**
 * In page order. `anchors` are the ids links point at (/#isom); a hidden
 * section's anchors lose their menu and footer links.
 */
export const HOME_SECTIONS = [
  { key: 'this-week', label: 'This Week', hint: 'Next gathering, live now and what is coming up, under the hero', icon: 'fa-calendar-week', anchors: ['this-week'] },
  { key: 'latest-news', label: 'Church News', hint: 'The latest stories from the News page', icon: 'fa-newspaper', anchors: ['latest-news'] },
  { key: 'events', label: 'Upcoming Events', hint: 'The next event large, the rest in a list', icon: 'fa-calendar-alt', anchors: ['news'] },
  { key: 'plan-visit', label: 'Plan Your Visit', hint: 'Service times and what to expect', icon: 'fa-route', anchors: ['plan-visit', 'services'] },
  { key: 'about', label: 'Welcome & Our Pastors', hint: 'Who we are, what we believe, and the pastors', icon: 'fa-church', anchors: ['about', 'pastors'] },
  { key: 'community-hub', label: 'Community Hub', hint: 'The invitation to the members’ hub', icon: 'fa-comments', anchors: [] },
  { key: 'ministries', label: 'Find Your Place', hint: 'The ministries and the ways we gather', icon: 'fa-people-group', anchors: ['ministries'] },
  { key: 'isom', label: 'ISOM', hint: 'International School of Ministries', icon: 'fa-graduation-cap', anchors: ['isom'] },
  { key: 'give', label: 'Give', hint: 'The newest donation drive (only while one is open)', icon: 'fa-hand-holding-heart', anchors: [] },
  { key: 'location', label: 'Visit Us', hint: 'The address and the map', icon: 'fa-map-location-dot', anchors: ['location'] },
  { key: 'cta', label: 'Closing banner', hint: '“Join Our Church Family Today”, or “Welcome back” when signed in', icon: 'fa-flag-checkered', anchors: [] },
];

const KEYS = new Set(HOME_SECTIONS.map((s) => s.key));

/** Whatever was saved (an object or its JSON) -> { hidden: [known keys] }. */
export function normalizeHomeSections(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const hidden = Array.isArray(v?.hidden) ? [...new Set(v.hidden.map(String).filter((k) => KEYS.has(k)))] : [];
  return { hidden };
}

/** The anchors (/#isom) that lead nowhere while these sections are hidden. */
export function hiddenAnchors(hidden = []) {
  const set = new Set(hidden);
  return new Set(HOME_SECTIONS.filter((s) => set.has(s.key)).flatMap((s) => s.anchors));
}

/** The anchor a link points at: '/#isom' or '#isom' -> 'isom'; anything else -> null. */
export const anchorOf = (href) => {
  const m = String(href || '').match(/^\/?#([\w-]+)$/);
  return m ? m[1] : null;
};
