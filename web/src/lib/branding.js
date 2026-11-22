/* ============================================================
   Whose name the site wears: the church's, or the platform's.

   The same pages serve two audiences. To a visitor from Cebu the site is
   Joyful Sound Church - International, and that is the name they expect on
   the door. To a panel, a partner church or anyone being shown the system,
   it is SanctuaryHub - the church management platform the church runs on.
   A Super Admin picks which one under System Configuration, and every public
   page follows.

   Either way the church is still named. In platform mode SanctuaryHub is the
   headline and the church is the line under it, because the services, the
   pastors and the address are still that church's.

   The setting lives in `system_settings` under the key below, as
   `{ "mode": "church" | "platform" }`. This file is the one place that knows
   its shape and what each mode says, so the admin card, the API, the layout
   and every page read the same words.

   Pure functions only - imported by server and client code alike.
   ============================================================ */

export const BRANDING_KEY = 'branding';
export const BRANDING_TAG = 'site-branding'; // fetch-cache tag, refreshed by PUT /api/branding

export const BRAND_MODES = ['church', 'platform'];

export const CHURCH_NAME = 'Joyful Sound Church';
export const CHURCH_SUFFIX = 'International';
export const CHURCH_FULL_NAME = 'Joyful Sound Church – International';
export const CHURCH_SHORT = 'JSCI';
export const PLATFORM_NAME = 'SanctuaryHub';
export const PLATFORM_TAGLINE = 'AI-Powered Church Management Platform';

// A site that has never saved the setting shows the church, as it always has.
export const BRANDING_DEFAULT = Object.freeze({ mode: 'church' });

const PRESETS = {
  church: {
    mode: 'church',
    name: CHURCH_NAME,              // the headline
    sub: CHURCH_SUFFIX,             // the line under it
    navSub: CHURCH_SUFFIX,          // the small line in a navbar lockup
    full: CHURCH_FULL_NAME,         // one line, wherever the name is said in a sentence
    siteTitle: `${CHURCH_NAME} ${CHURCH_SUFFIX}`, // the browser tab
    owner: CHURCH_FULL_NAME,        // the copyright holder
  },
  platform: {
    mode: 'platform',
    name: PLATFORM_NAME,
    sub: CHURCH_FULL_NAME,
    navSub: 'Church Platform',
    full: PLATFORM_NAME,
    siteTitle: `${PLATFORM_NAME} · ${CHURCH_FULL_NAME}`,
    owner: PLATFORM_NAME,
  },
};

// Read whatever is in the database back into a mode.
//
// Forgiving on purpose, like normalizeHeroMedia: `system_settings.value` is
// JSONB, and the older generic settings endpoint writes through
// JSON.stringify, so the value can come back as an object, as a string holding
// one, or as the bare word. Anything unrecognised is the church.
export const normalizeBranding = (raw) => {
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (BRAND_MODES.includes(text)) return { mode: text };
    try { value = JSON.parse(text); } catch { return { ...BRANDING_DEFAULT }; }
    if (typeof value === 'string') return normalizeBranding(value);
  }
  const mode = value && typeof value === 'object' ? value.mode : '';
  return { mode: BRAND_MODES.includes(mode) ? mode : BRANDING_DEFAULT.mode };
};

// Everything a page needs to say the name, for a stored setting (or a mode).
export const brandFor = (raw) => {
  const { mode } = typeof raw === 'string' && BRAND_MODES.includes(raw) ? { mode: raw } : normalizeBranding(raw);
  return {
    ...PRESETS[mode],
    church: CHURCH_FULL_NAME,       // the church itself, in either mode
    churchShort: CHURCH_SHORT,
    platform: PLATFORM_NAME,
    platformTagline: PLATFORM_TAGLINE,
    isPlatform: mode === 'platform',
  };
};
