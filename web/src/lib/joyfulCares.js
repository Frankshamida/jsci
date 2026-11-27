// Joyful Cares - the words and rules the Pastors' care desk shares between
// the server (lib/joyfulCaresServer.js, /api/cares) and the page
// (components/cares). Safe to import in the browser and on the server.

export const CARE_MIGRATION_NOTE = 'Joyful Cares needs its database tables: run supabase/migrations/joyful_cares.sql in the Supabase SQL editor, then try again.';

// Who may open it (a Super Admin always may).
export const CARE_ROLES = ['Pastor'];

// The weeks of history read, the "lately" window and the rules' thresholds.
export const CARE_WINDOW_WEEKS = 16;
export const CARE_RECENT_DAYS = 30;
export const RULES = {
  followStreak: 3,      // Sundays in a row without a check-in or an approved excuse
  followDuties: 2,      // lineup duties missed in 30 days
  watchStreak: 2,
  watchDuties: 1,
  watchPractices: 2,    // practices missed in 30 days
  watchExcuses: 3,      // excuses sent in 30 days
  watchSubs: 3,         // substitute requests in 30 days
};

// In this order: the most pressing first.
export const STATUSES = {
  follow: { label: 'Needs follow-up', short: 'Follow up', icon: 'fa-hand-holding-heart', rank: 0 },
  watch: { label: 'Watch', short: 'Watch', icon: 'fa-eye', rank: 1 },
  care: { label: 'In care', short: 'In care', icon: 'fa-heart', rank: 2 },
  well: { label: 'Doing well', short: 'Doing well', icon: 'fa-circle-check', rank: 3 },
};
export const STATUS_ORDER = ['follow', 'watch', 'care', 'well'];

// What the AI may suggest, and how each is shown.
export const STEP_KINDS = {
  encourage: { label: 'Send encouragement', icon: 'fa-envelope-open-text' },
  call: { label: 'Give them a call', icon: 'fa-phone' },
  visit: { label: 'Visit them', icon: 'fa-house-chimney-user' },
  pray: { label: 'Pray with them', icon: 'fa-hands-praying' },
  practical: { label: 'Offer practical help', icon: 'fa-hands-holding-circle' },
  counsel: { label: 'Invite to a counselling talk', icon: 'fa-comments' },
};
export const URGENCY = { low: 'No rush', medium: 'This week', high: 'Soon' };
export const DRAFT_LANGS = [
  { id: 'en', label: 'English' },
  { id: 'tl', label: 'Tagalog' },
  { id: 'ceb', label: 'Cebuano' },
];

export const NOTE_KINDS = {
  note: { label: 'Note', icon: 'fa-pen' },
  contacted: { label: 'Reached out', icon: 'fa-comment-dots' },
  care: { label: 'Taken into care', icon: 'fa-heart' },
  assigned: { label: 'Care updated', icon: 'fa-user-pen' },
  cleared: { label: 'Flags cleared', icon: 'fa-broom' },
  closed: { label: 'Care closed', icon: 'fa-circle-check' },
};

export const LIMITS = { note: 1500, outcome: 600 };

/**
 * Puts the member's first name back into what the AI wrote: it only ever
 * knew them as "Member A", and wrote the drafts with {name}.
 */
export const fillDraft = (text, firstname) => String(text || '')
  .replace(/\{name\}/gi, firstname || 'there')
  .replace(/\bMember A\b/g, firstname || 'they');
