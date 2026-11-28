// ============================================================
// Meet the Developers - what the website's window, its admin page and its
// route share: the role icons, the photo's size, the limits on the words,
// and the window's words before an admin has changed them.
// Safe on the server and in the browser.
// ============================================================

export const DEV_MAX = 6;

/** The icons a role pill can carry. `fa` is the Font Awesome icon. */
export const DEV_ROLE_ICONS = [
  { key: 'clipboard', label: 'Clipboard (Project Manager)', fa: 'fa-clipboard-check' },
  { key: 'pen', label: 'Pen tool (UI / UX Design)', fa: 'fa-pen-nib' },
  { key: 'code', label: 'Code (Developer)', fa: 'fa-code' },
];
export const roleIconFa = (key) => (DEV_ROLE_ICONS.find((i) => i.key === key) || DEV_ROLE_ICONS[2]).fa;
export const isRoleIcon = (key) => DEV_ROLE_ICONS.some((i) => i.key === key);

/** Roles to pick from in the admin form (any other may be typed). */
export const DEV_ROLE_SUGGESTIONS = ['Project Manager', 'UI / UX Design', 'Full Stack Developer', 'Front-end Developer', 'Back-end Developer', 'Quality Assurance', 'Documentation'];

/**
 * The card's photo: cropped in the browser to exactly the card's 7:10 frame
 * and saved as 700 x 1000 WebP. A crop smaller than 490 x 700 of the original
 * gets a "may look blurry" warning.
 */
export const DEV_PHOTO = {
  width: 700,
  height: 1000,
  aspect: 7 / 10,
  minWidth: 490,
  minHeight: 700,
  accept: ['image/jpeg', 'image/png', 'image/webp'],
  maxSourceBytes: 10 * 1024 * 1024, // what an admin may pick
  maxUploadBytes: 3 * 1024 * 1024, // what the route takes (the crop is ~300 KB)
  folder: 'JSCI-System/developers',
};

export const DEV_LIMITS = { surname: 40, givenNames: 60, role: 40, badge: 40, headline: 60, description: 280 };

export const DEFAULT_DEV_SETTINGS = {
  badge: 'Capstone Project 2026',
  headline: 'Welcome to SanctuaryHub',
  description: 'Designed and developed by students of the College of Computer Studies, University of Cebu, for Joyful Sound Church – International. Meet the team behind the platform.',
  autoShow: true,
};

export const DEVELOPERS_MIGRATION_NOTE = 'The developers tables are not in the database yet. Run supabase/migrations/site_developers.sql in the Supabase SQL editor.';

/**
 * The headline in three parts, the middle one in gold: the platform's name
 * where the headline says it ("Welcome to SanctuaryHub"), else its last word.
 * @returns {[string, string, string]}
 */
export function splitHeadline(text, platform = 'SanctuaryHub') {
  const s = String(text || '').trim();
  if (!s) return ['', '', ''];
  const at = platform ? s.toLowerCase().lastIndexOf(platform.toLowerCase()) : -1;
  if (at >= 0) return [s.slice(0, at), s.slice(at, at + platform.length), s.slice(at + platform.length)];
  const m = s.match(/^(.*\s)?(\S+)$/);
  return m ? [m[1] || '', m[2], ''] : [s, '', ''];
}

/** A row of site_developers as the website reads it. */
export const shapeDeveloper = (r) => ({
  id: r.id,
  surname: r.surname,
  givenNames: r.given_names || '',
  role: r.role || '',
  roleIcon: isRoleIcon(r.role_icon) ? r.role_icon : 'code',
  photoUrl: r.photo_url || null,
  active: r.is_active !== false,
  order: r.sort_order ?? 0,
});

/** The settings row as the website reads it (defaults for anything unset). */
export const shapeDevSettings = (r) => ({
  badge: r?.badge ?? DEFAULT_DEV_SETTINGS.badge,
  headline: r?.headline || DEFAULT_DEV_SETTINGS.headline,
  description: r?.description ?? DEFAULT_DEV_SETTINGS.description,
  autoShow: r ? r.auto_show !== false : DEFAULT_DEV_SETTINGS.autoShow,
});
