// The dashboard sidebar for each role: the pages pinned under Home, then the
// dropdowns the rest sit in, in the order that role uses them most.
//
// A layout only ARRANGES pages. Which pages an account has is still decided by
// SECTION_ACCESS and Permissions Control (lib/permissions.js); ids here are
// getSidebarMenu() item ids, plus the three Give choices ('give:tithes', ...)
// and the two Giving pages ('giving:gifts', 'giving:drives'), which take the
// place of getSidebarMenu's one 'giving' item.
//
// Rules (agreed with the church in the "Sidebar by Role" preview):
//  - Home first, for everyone; then that role's pinned pages.
//  - A dropdown with only one page shows as a plain button.
//  - No catch-all "More": a page the layout does not list (an account with two
//    roles, say Admin + Pastor) goes to its usual group in this layout, or to
//    a group of its own.
//  - My Profile is not in the menu: the account card at the bottom opens it.

import { getDashboardType, getUserRoles } from '@/lib/permissions';
import { GIVE_TABS } from '@/components/giving/giveTabs';

export const GIVE_ITEMS = GIVE_TABS.map((t) => ({
  id: `give:${t.id}`, section: 'give', giveTab: t.id, label: t.label, icon: `fas ${t.icon}`,
}));
const GIVE_IDS = GIVE_ITEMS.map((i) => i.id);

// Dashboard > Giving is two pages in the menu, one section (giving-management)
// that shows the one the menu chose.
export const GIVING_ITEMS = [
  { id: 'giving:gifts', section: 'giving-management', givingTab: 'gifts', label: 'Gifts', icon: 'fas fa-receipt' },
  { id: 'giving:drives', section: 'giving-management', givingTab: 'drives', label: 'Donation drives', icon: 'fas fa-hand-holding-heart' },
];
const GIVING_IDS = GIVING_ITEMS.map((i) => i.id);

// A Guest's extras, which are not dashboard sections: the two service pages
// (links out of the dashboard, `href`), and the Community Hub shown locked
// (`memberOnly`) - a Guest cannot open it, but should know it is there and
// how it opens. Only a layout that lists them shows them.
export const GUEST_ITEMS = [
  { id: 'watch:sunday', href: '/sunday-service', label: 'Sunday Service', icon: 'fas fa-tv' },
  { id: 'watch:midweek', href: '/midweek', label: 'Midweek Service', icon: 'fas fa-circle-play' },
  { id: 'hub:members', memberOnly: true, label: 'Community Hub', icon: 'fas fa-comments' },
];

// Reached another way, so never in the menu.
const NOT_IN_MENU = new Set(['profile']);

// Sidebar names that differ from getSidebarMenu's.
const MENU_LABELS = { 'payment-methods': 'Payment methods' };

// Every group a layout can have, with its usual look. A layout may rename one.
const GROUPS = {
  people: { label: 'People', icon: 'fas fa-users' },
  worship: { label: 'Worship & Ministry', icon: 'fas fa-hands-praying' },
  events: { label: 'Events', icon: 'fas fa-calendar-alt' },
  church: { label: 'Church Life', icon: 'fas fa-church' },
  giving: { label: 'Giving', icon: 'fas fa-hand-holding-heart' },
  publishing: { label: 'Publishing', icon: 'fas fa-bullhorn' },
  community: { label: 'Community', icon: 'fas fa-comments' },
  isom: { label: 'ISOM School', icon: 'fas fa-graduation-cap' },
  reports: { label: 'Reports & Logs', icon: 'fas fa-chart-bar' },
  system: { label: 'System Settings', icon: 'fas fa-cogs' },
  resources: { label: 'Resources', icon: 'fas fa-book-open' },
  watch: { label: 'Watch', icon: 'fas fa-circle-play' },
};
const g = (key, ids, extra = {}) => ({ key, ...GROUPS[key], ...extra, ids });

export const SIDEBAR_LAYOUTS = {
  'super-admin': {
    pinned: ['home'],
    groups: [
      g('people', ['users', 'ministries', 'attendance', 'joyful-cares']),
      g('worship', ['schedule', 'lineup', 'praise-worship', 'song-playlist', 'meetings', 'recordings']),
      g('events', ['events', 'community-events', 'rfid', 'accommodation', 'my-created-events', 'user-events-oversight']),
      g('giving', [...GIVING_IDS, 'payment-methods', ...GIVE_IDS]),
      g('publishing', ['announcements', 'news', 'sermons', 'live-stream-mgmt', 'developers']),
      g('community', ['community', 'messages']),
      g('isom', ['isom', 'isom-inquiries']),
      g('reports', ['reports', 'audit', 'cloudinary-usage']),
      g('system', ['roles', 'permissions-control', 'system', 'terms-conditions']),
      g('resources', ['bible', 'assistant']),
    ],
  },
  admin: {
    pinned: ['home'],
    groups: [
      g('people', ['users', 'ministries', 'attendance', 'isom-inquiries']),
      g('events', ['events', 'community-events', 'rfid', 'accommodation', 'my-created-events', 'user-events-oversight']),
      g('giving', [...GIVING_IDS, 'payment-methods', ...GIVE_IDS]),
      g('publishing', ['announcements', 'news', 'sermons', 'live-stream-mgmt', 'developers']),
      g('worship', ['schedule', 'lineup', 'praise-worship', 'song-playlist', 'meetings', 'recordings']),
      g('community', ['community', 'messages']),
      g('reports', ['reports'], { label: 'Reports' }),
      g('resources', ['bible', 'assistant']),
    ],
  },
  pastor: {
    pinned: ['home', 'joyful-cares'],
    groups: [
      g('worship', ['sermons', 'schedule', 'praise-worship', 'song-playlist', 'lineup', 'meetings', 'recordings'],
        { label: 'Preaching & Worship', icon: 'fas fa-book-bible' }),
      g('church', ['announcements', 'events', 'community-events', 'user-events-oversight', 'my-created-events']),
      g('community', ['community', 'messages']),
      g('giving', GIVE_IDS),
      g('isom', ['isom-inquiries'], { label: 'ISOM' }),
      g('resources', ['bible']),
      g('reports', ['reports'], { label: 'Reports' }),
    ],
  },
  ministry: {
    pinned: ['home', 'schedule'],
    groups: [
      g('worship', ['praise-worship', 'lineup', 'song-playlist', 'meetings', 'recordings'], { label: 'My Ministry' }),
      g('church', ['announcements', 'events', 'community-events', 'sermons', 'my-created-events']),
      g('community', ['community', 'messages']),
      g('giving', GIVE_IDS, { label: 'Give' }),
      g('resources', ['bible']),
      g('reports', ['reports'], { label: 'Reports' }),
    ],
  },
  member: {
    pinned: ['home'],
    groups: [
      g('church', ['announcements', 'events', 'community-events', 'sermons', 'schedule', 'recordings', 'my-created-events']),
      g('community', ['community', 'messages']),
      g('giving', GIVE_IDS, { label: 'Give' }),
      g('resources', ['bible']),
      g('reports', ['reports'], { label: 'Reports' }),
    ],
  },
  // A Guest: what they may open, the services to watch, and the Community Hub
  // shown locked until the church welcomes them as a member.
  guest: {
    pinned: ['home', 'events', 'announcements'],
    groups: [
      g('giving', GIVE_IDS, { label: 'Give' }),
      g('watch', ['watch:sunday', 'watch:midweek']),
      g('community', ['hub:members']),
      g('resources', ['bible']),
    ],
  },
};

// Where a page goes when the layout does not list it: the first of these
// groups the layout has. 'pin' puts it under Home.
const USUAL_GROUPS = {
  'joyful-cares': ['people', 'pin'],
  users: ['people'], ministries: ['people'], attendance: ['people'], roles: ['system', 'people'],
  schedule: ['worship', 'church'], lineup: ['worship', 'church'], 'praise-worship': ['worship', 'church'],
  'song-playlist': ['worship', 'church'], meetings: ['worship', 'church'], recordings: ['worship', 'church'],
  events: ['events', 'church'], 'community-events': ['events', 'church'], rfid: ['events', 'church'],
  accommodation: ['events', 'church'], 'my-created-events': ['events', 'church'], 'user-events-oversight': ['events', 'church'],
  announcements: ['publishing', 'church'], news: ['publishing', 'church'], developers: ['publishing'], sermons: ['publishing', 'worship', 'church'],
  'live-stream-mgmt': ['publishing', 'community'],
  community: ['community'], messages: ['community'],
  'giving:gifts': ['giving'], 'giving:drives': ['giving'], 'payment-methods': ['giving'],
  isom: ['isom', 'people'], 'isom-inquiries': ['isom', 'people'],
  reports: ['reports'], audit: ['reports', 'system'], 'cloudinary-usage': ['reports', 'system'],
  'permissions-control': ['system'], system: ['system'], 'terms-conditions': ['system'],
  bible: ['resources'], assistant: ['resources'],
};
const MINISTRY_ROLES = ['Ministry Member', 'Song Leader', 'Leader'];

/** Which layout an account gets: its highest role's. */
export function sidebarLayoutKey(user, effectiveRole) {
  const type = getDashboardType(effectiveRole);
  // Church Members and Ministry Members share the 'ministry' dashboard; their
  // sidebars differ.
  if (type !== 'ministry' && SIDEBAR_LAYOUTS[type]) return type;
  return getUserRoles(user).some((r) => MINISTRY_ROLES.includes(r)) ? 'ministry' : 'member';
}

/**
 * The sidebar to draw: [{ type: 'item', item } | { type: 'divider' } |
 * { type: 'group', key, label, icon, items }], in order.
 * @param {string} layoutKey  from sidebarLayoutKey()
 * @param {Array} menu        the account's own items (already filtered by access)
 */
export function buildSidebar(layoutKey, menu) {
  const layout = SIDEBAR_LAYOUTS[layoutKey] || SIDEBAR_LAYOUTS.member;
  menu = menu
    .flatMap((m) => (m.id === 'giving' ? GIVING_ITEMS : [m]))
    .map((m) => (MENU_LABELS[m.id] ? { ...m, label: MENU_LABELS[m.id] } : m));
  const byId = new Map([...menu, ...GIVE_ITEMS, ...GUEST_ITEMS].filter((m) => !NOT_IN_MENU.has(m.id)).map((m) => [m.id, m]));
  const used = new Set();
  const take = (id) => {
    const item = byId.get(id);
    if (!item || used.has(id)) return null;
    used.add(id);
    return item;
  };

  const pinned = layout.pinned.map(take).filter(Boolean);
  const groups = layout.groups.map((grp) => ({ ...grp, items: grp.ids.map(take).filter(Boolean) }));

  // Pages this layout does not list.
  menu.forEach((m) => {
    if (used.has(m.id) || NOT_IN_MENU.has(m.id)) return;
    used.add(m.id);
    const homes = USUAL_GROUPS[m.id] || [];
    if (homes[0] === 'pin' || (homes.includes('pin') && !homes.some((k) => groups.some((x) => x.key === k)))) {
      pinned.push(m);
      return;
    }
    const home = homes.map((k) => groups.find((x) => x.key === k)).find(Boolean);
    if (home) { home.items.push(m); return; }
    const key = homes[0] || `own-${m.id}`;
    groups.push({ key, ...(GROUPS[key] || { label: m.label, icon: m.icon }), items: [m] });
  });

  // Giving holds the office's pages and the giver's: a small label over each
  // part when it has both.
  groups.filter((grp) => grp.key === 'giving').forEach((grp) => {
    const manage = grp.items.filter((it) => !it.giveTab);
    const give = grp.items.filter((it) => it.giveTab);
    if (!manage.length || !give.length) return;
    grp.items = grp.items.map((it) => {
      if (it === manage[0]) return { ...it, heading: 'Manage' };
      if (it === give[0]) return { ...it, heading: 'Your giving' };
      return it;
    });
  });

  const out = pinned.map((item) => ({ type: 'item', item }));
  const rest = groups.filter((grp) => grp.items.length > 0).map((grp) => (grp.items.length === 1
    ? { type: 'item', item: grp.items[0] } // one page: a plain button
    : { type: 'group', key: grp.key, label: grp.label, icon: grp.icon, items: grp.items }));
  if (out.length && rest.length) out.push({ type: 'divider' });
  return [...out, ...rest];
}

/**
 * Is this menu item the page on screen? `tabs` says which Give choice and
 * which Giving page are showing: { give, giving } (or, as before, the Give
 * choice alone).
 */
export const isItemActive = (item, activeSection, tabs = {}) => {
  const t = typeof tabs === 'string' ? { give: tabs } : (tabs || {});
  if (item.giveTab) return activeSection === 'give' && t.give === item.giveTab;
  if (item.givingTab) return activeSection === 'giving-management' && (t.giving || 'gifts') === item.givingTab;
  return activeSection === item.section;
};
