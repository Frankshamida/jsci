// ============================================
// ROLE DETAILS
// What an account keeps beyond its role names: a Ministry Member's ministry
// roles and positions, a Pastor's titles, and the event types they may create.
// Shared by the User Management screen and /api/admin/users so the form, the
// role-change warning and the server agree on what is saved and on what a
// role change deletes. An account can hold several roles (users.role plus
// users.additional_roles); each detail is kept while ANY held role owns it.
// ============================================
import { ROLES, ASSIGNABLE_ROLES, LEGACY_ROLES, SONG_LEADER_POSITION, SCHEDULE_PLOTTER_POSITION, splitSubRole, getUserRoles, roleRank, canAccessSection } from './permissions';

const PAW = 'Praise And Worship';

// One line per role, shown when a role is picked or changed.
export const ROLE_DESCRIPTIONS = {
  [ROLES.GUEST]: 'Newly registered. Limited access until given a role.',
  [ROLES.CHURCH_MEMBER]: 'Belongs to the church but does not serve in a ministry.',
  [ROLES.MINISTRY_MEMBER]: 'Serves in a ministry: Praise & Worship, Media or Ushers.',
  [ROLES.PASTOR]: 'Oversees ministries, schedules, announcements and attendance.',
  [ROLES.ADMIN]: 'Manages users, ministries, events and the church desk.',
  [ROLES.SUPER_ADMIN]: 'Full control, including roles, permissions and settings.',
};

// The ministry roles a Ministry Member can hold. They save into the existing
// `ministry` and `sub_role` columns using the exact spellings the Praise &
// Worship screens already search for, so nobody drops out of a lineup:
//   Song Leaders  - sub_role ILIKE '%Song Leaders%' (/api/lineup/singers)
//   Backup Singer - sub_role ILIKE '%Backup Singer%'
//   Musicians     - 'Instrumentalist', which is why every musician carries it
//   Dancers       - 'Dancer' ('Head Dancer' contains it)
// `aliases` are older spellings typed in by hand before this form existed.
// They are read as the position they mean and saved back in the new spelling.
export const MINISTRY_ROLES = [
  {
    key: 'singer', label: 'Singer (PAW)', title: 'Singer', group: 'Praise and Worship',
    icon: 'fa-microphone', ministry: PAW, kind: 'multi',
    positions: [
      { label: 'Song Leader', token: SONG_LEADER_POSITION },
      { label: 'Backup Singer', token: 'Backup Singer' },
    ],
    aliases: { 'Song Leader': SONG_LEADER_POSITION },
  },
  {
    key: 'musician', label: 'Musician (PAW)', title: 'Musician', group: 'Praise and Worship',
    icon: 'fa-guitar', ministry: PAW, kind: 'multi',
    baseToken: 'Instrumentalist',
    positions: ['Music Director', 'Keyboard', 'Bass', 'Drummer', 'Guitarist'].map((p) => ({ label: p, token: p })),
    aliases: { Instrumentalists: 'Instrumentalist' },
  },
  {
    key: 'dancer', label: 'Dancer (PAW)', title: 'Dancer', group: 'Praise and Worship',
    icon: 'fa-person-running', ministry: PAW, kind: 'toggle',
    headToken: 'Head Dancer', memberToken: 'Dancer', memberLabel: 'Regular dancer', headHint: 'Leads the dance team',
    aliases: { Dancers: 'Dancer' },
    ministryAliases: ['Dancers'],
  },
  {
    key: 'media', label: 'Media', title: 'Media', group: 'Media Ministry',
    icon: 'fa-camera', ministry: 'Media', kind: 'multi',
    positions: ['Media Head', 'Lyrics', 'Media Live', 'Graphics', 'Technical', 'Social Media'].map((p) => ({ label: p, token: p })),
  },
  {
    // The ministries table spells the ushers' ministry "Ashers". It is saved
    // that way so existing ushers and the Ministry filter still line up.
    key: 'usher', label: 'Usher', title: 'Usher', group: 'Ushering Ministry',
    icon: 'fa-door-open', ministry: 'Ashers', kind: 'toggle',
    headToken: 'Head Usher', memberToken: 'Usher', memberLabel: 'Regular usher', headHint: 'Leads the ushers',
    ministryAliases: ['Ushers'],
  },
];

export const PASTOR_TITLES = ['Senior Pastor', 'Associate Pastor', 'Head Pastor', 'Youth Pastor'];

// The instruments the Monthly Planner fills each Sunday (schedules.musicians,
// keyed by `token`). The choices are the Musicians (PAW) with that position.
export const LINEUP_INSTRUMENTS = [
  { token: 'Keyboard', label: 'Keyboard', icon: 'fa-keyboard' },
  { token: 'Guitarist', label: 'Guitar', icon: 'fa-guitar' },
  { token: 'Bass', label: 'Bass', icon: 'fa-guitar' },
  { token: 'Drummer', label: 'Drums', icon: 'fa-drum' },
];

/**
 * Every part on one lineup, by person:
 *   { 'ana cruz': { name: 'Ana Cruz', parts: ['Backup Singer', 'Keyboard'] } }
 * One person has ONE part on a date - Song Leader, Backup Singer, one
 * instrument, or Dancer - so anybody with two is double-booked
 * (lineupDoubleBooked).
 */
export function lineupParts({ songLeader, backupSingers = [], musicians = {}, dancers = [] } = {}) {
  const parts = {};
  const add = (name, part) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return;
    if (!parts[key]) parts[key] = { name: String(name).trim(), parts: [] };
    if (!parts[key].parts.includes(part)) parts[key].parts.push(part);
  };
  add(songLeader, 'Song Leader');
  (backupSingers || []).forEach((n) => add(n, 'Backup Singer'));
  LINEUP_INSTRUMENTS.forEach(({ token, label }) => (musicians?.[token] || []).forEach((n) => add(n, label)));
  (dancers || []).forEach((n) => add(n, 'Dancer'));
  return parts;
}

/** A lineup's name list as saved: trimmed, no blanks, no repeats. */
export const cleanNameList = (names) => [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))];

/** The people on a lineup with more than one part: [{ name, parts }]. */
export const lineupDoubleBooked = (lineup) => Object.values(lineupParts(lineup)).filter((p) => p.parts.length > 1);

/** schedules.musicians as saved: only instruments someone plays, names trimmed. */
export function cleanLineupMusicians(musicians) {
  const out = {};
  LINEUP_INSTRUMENTS.forEach(({ token }) => {
    const names = [...new Set((musicians?.[token] || []).map((n) => String(n || '').trim()).filter(Boolean))];
    if (names.length) out[token] = names;
  });
  return out;
}

const asRoles = (roles) => (Array.isArray(roles) ? roles : [roles]);

export const isLegacyRole = (role) => Object.values(LEGACY_ROLES).includes(role);

// Which roles own which details. The retired roles keep everything they had
// so their accounts work until the migration runs.
const keepsMinistry = (roles) => asRoles(roles).some((r) => r === ROLES.MINISTRY_MEMBER || isLegacyRole(r));
const keepsPastorTitles = (roles) => asRoles(roles).includes(ROLES.PASTOR);

/** Who can be given event-creation permissions ("My Events"). */
export const canHoldEventPermissions = (roles) => keepsMinistry(roles) || keepsPastorTitles(roles);

// A ministry is a kind of church membership: an account is one or the other.
const MEMBERSHIP_ROLES = [ROLES.CHURCH_MEMBER, ROLES.MINISTRY_MEMBER];

/**
 * The roles a Super Admin may add on top of an account's main role. Nothing
 * for a Guest (they get a main role first), never Guest, nothing held
 * already, and no second kind of membership.
 */
export function getAddableRoles(user) {
  if (!user?.role || user.role === ROLES.GUEST) return [];
  const held = getUserRoles(user);
  const hasMembership = held.some((r) => MEMBERSHIP_ROLES.includes(r));
  return ASSIGNABLE_ROLES.filter((r) => r !== ROLES.GUEST
    && !held.includes(r)
    && !(hasMembership && MEMBERSHIP_ROLES.includes(r)));
}

/**
 * The added roles that survive `mainRole` becoming the main role: not the
 * main role itself, and not the other kind of membership.
 */
export function additionalRolesFor(mainRole, additional = []) {
  if (mainRole === ROLES.GUEST) return [];
  return [...new Set(additional)].filter((r) => r !== mainRole && r !== ROLES.GUEST
    && !(MEMBERSHIP_ROLES.includes(mainRole) && MEMBERSHIP_ROLES.includes(r)));
}

/**
 * Split a set of roles into the users.role / users.additional_roles to save.
 * users.role is always the HIGHEST role held: the server checks it directly
 * (Admin-only routes read users.role), so an Admin must never sit in
 * additional_roles. An empty set is a Guest.
 * @returns {{ role: string, additional_roles: string[] }}
 */
export function arrangeRoles(roles) {
  const held = [...new Set(roles)].filter((r) => r && r !== ROLES.GUEST)
    .sort((a, b) => roleRank(b) - roleRank(a));
  if (held.length === 0) return { role: ROLES.GUEST, additional_roles: [] };
  return { role: held[0], additional_roles: held.slice(1) };
}

export const getMinistryRole = (key) => MINISTRY_ROLES.find((mr) => mr.key === key) || null;

// The token as this ministry role saves it, or null when it is not one of its own.
function ownToken(mr, token) {
  const t = mr.aliases?.[token] || token;
  if (mr.kind === 'toggle') return t === mr.headToken || t === mr.memberToken ? t : null;
  if (t === mr.baseToken) return t;
  return mr.positions.some((p) => p.token === t) ? t : null;
}

/**
 * Read a saved ministry and sub_role back into the form's terms: one card per
 * ministry role the account holds. No two ministry roles share a sub_role
 * token, so the tokens alone say which cards there are.
 * @returns {{ cards: { key: string, positions: string[], head: boolean }[], leftover: string[] }}
 *   positions are sub_role tokens. leftover are saved values the form has no
 *   place for; they are dropped the next time the ministry roles are saved.
 */
export function parseMinistryCards(ministry, subRole) {
  const all = splitSubRole(subRole).filter((t) => !PASTOR_TITLES.includes(t));
  // The Schedule Plotter switch is a duty, not a ministry role: no card.
  const plotter = all.includes(SCHEDULE_PLOTTER_POSITION);
  const tokens = all.filter((t) => t !== SCHEDULE_PLOTTER_POSITION);
  const owned = new Map(); // ministry role key -> its tokens, as it saves them
  const leftover = [];
  tokens.forEach((t) => {
    const mr = MINISTRY_ROLES.find((m) => ownToken(m, t));
    if (mr) owned.set(mr.key, [...(owned.get(mr.key) || []), ownToken(mr, t)]);
    else leftover.push(t);
  });
  // The ministry column on its own can name a ministry role whose positions
  // were never saved ("Ashers" with no sub_role, "Media" with only
  // "Multimedia"). Praise And Worship cannot: Singer, Musician and Dancer share it.
  const named = MINISTRY_ROLES.filter((mr) => mr.ministry === ministry || mr.ministryAliases?.includes(ministry));
  if (named.length === 1 && !owned.has(named[0].key)) owned.set(named[0].key, []);

  const cards = MINISTRY_ROLES.filter((mr) => owned.has(mr.key)).map((mr) => {
    const own = owned.get(mr.key);
    return {
      key: mr.key,
      positions: mr.kind === 'multi' ? [...new Set(own.filter((t) => t !== mr.baseToken))] : [],
      head: mr.kind === 'toggle' && own.includes(mr.headToken),
    };
  });
  return { cards, leftover, plotter };
}

/**
 * The ministry and sub_role to save for the cards on the form. `ministry`
 * holds a single value, so it gets the first in MINISTRY_ROLES order: Praise
 * And Worship, then Media, then Ushers. PAW goes first because the lineup
 * finds people by ministry = 'Praise And Worship'; the other ministries are
 * still told apart by their positions in sub_role (see ministriesOf).
 * @returns {{ ministry: string|null, sub_role: string|null }}
 */
export function buildMinistryCards(cards = [], { plotter = false } = {}) {
  const held = MINISTRY_ROLES
    .map((mr) => ({ mr, card: cards.find((c) => c.key === mr.key) }))
    .filter(({ card }) => card);
  const tokens = held.flatMap(({ mr, card }) => (mr.kind === 'toggle'
    ? [card.head ? mr.headToken : mr.memberToken]
    : [
      ...(mr.baseToken ? [mr.baseToken] : []),
      // In the form's order, not the order they were ticked.
      ...mr.positions.map((p) => p.token).filter((t) => (card.positions || []).includes(t)),
    ]));
  if (plotter) tokens.push(SCHEDULE_PLOTTER_POSITION);
  return { ministry: held[0]?.mr.ministry || null, sub_role: tokens.join(', ') || null };
}

/** Why the cards on the form cannot be saved yet, or null. */
export function ministryCardsError(cards = []) {
  const unfinished = cards.find((c) => getMinistryRole(c.key)?.kind === 'multi' && !(c.positions || []).length);
  return unfinished ? `Pick at least one position for ${getMinistryRole(unfinished.key).label}.` : null;
}

/** Every ministry an account serves in. The ministry column holds only the first. */
export function ministriesOf(ministry, subRole) {
  const served = parseMinistryCards(ministry, subRole).cards.map((c) => getMinistryRole(c.key).ministry);
  return [...new Set([ministry, ...served].filter(Boolean))];
}

export const hasMinistryRole = (user, key) => parseMinistryCards(user?.ministry, user?.sub_role).cards.some((c) => c.key === key);

export const parsePastorTitles = (subRole) => {
  const tokens = splitSubRole(subRole);
  return PASTOR_TITLES.filter((t) => tokens.includes(t));
};

// Roles that bring details of their own. They are only ever given together
// with those details, in one save: never a Ministry Member with no ministry,
// never a Pastor with no title.
const ROLES_WITH_SETUP = [ROLES.MINISTRY_MEMBER, ROLES.PASTOR];

/** The roles in `nextRoles` that `user` does not hold yet and that need setting up. */
export const rolesNeedingSetup = (user, nextRoles) => {
  const held = getUserRoles(user);
  return ROLES_WITH_SETUP.filter((r) => nextRoles.includes(r) && !held.includes(r));
};

/**
 * Why giving `user` the roles `nextRoles` cannot be saved with this ministry
 * and sub_role, or null. A new Ministry Member needs at least one ministry
 * role, each with at least one position; a new Pastor at least one title.
 */
export function roleSetupError(user, nextRoles, ministry, subRole) {
  const needs = rolesNeedingSetup(user, nextRoles);
  if (needs.includes(ROLES.MINISTRY_MEMBER)) {
    const { cards } = parseMinistryCards(ministry, subRole);
    if (cards.length === 0) return 'Add at least one ministry role.';
    const error = ministryCardsError(cards);
    if (error) return error;
  }
  if (needs.includes(ROLES.PASTOR) && parsePastorTitles(subRole).length === 0) return 'Pick at least one pastor title.';
  return null;
}

/**
 * Keep only the details `roles` own, whatever the request sent. The server
 * runs every ministry / sub_role write through this.
 * @param {string|string[]} roles - every role the account will hold
 * @returns {{ ministry: string|null, sub_role: string|null }}
 */
export function roleDetailsFor(roles, ministry, subRole) {
  const tokens = splitSubRole(subRole);
  const ministryTokens = keepsMinistry(roles) ? tokens.filter((t) => !PASTOR_TITLES.includes(t)) : [];
  const titles = keepsPastorTitles(roles) ? PASTOR_TITLES.filter((t) => tokens.includes(t)) : [];
  return {
    ministry: keepsMinistry(roles) ? ministry || null : null,
    sub_role: [...ministryTokens, ...titles].join(', ') || null,
  };
}

/**
 * How an account's ministry reads in the users table: one group per ministry
 * role, e.g. "Singer (PAW)" with its positions. Values the form does not know
 * are still shown, never hidden.
 * @returns {{ key?: string, label: string|null, icon: string|null, chips: string[] }[]}
 */
export function describeMinistry(ministry, subRole) {
  const { cards, leftover, plotter } = parseMinistryCards(ministry, subRole);
  const groups = cards.map((card) => {
    const mr = getMinistryRole(card.key);
    const chips = mr.kind === 'toggle'
      ? [card.head ? mr.headToken : mr.memberLabel]
      : mr.positions.filter((p) => card.positions.includes(p.token)).map((p) => p.label);
    return { key: mr.key, label: mr.label, icon: mr.icon, chips };
  });
  if (plotter) groups.push({ key: 'plotter', label: SCHEDULE_PLOTTER_POSITION, icon: 'fa-calendar-check', chips: ['Plans the monthly lineup'] });
  if (leftover.length || (cards.length === 0 && ministry)) {
    groups.push({ label: cards.length ? 'Other' : ministry || 'Other', icon: null, chips: leftover });
  }
  return groups;
}

/** The users table's Ministry cell: a group per ministry role, plus pastor titles. */
export function describeRoleDetails(user) {
  const groups = keepsMinistry(getUserRoles(user)) || user?.ministry ? describeMinistry(user?.ministry, user?.sub_role) : [];
  const titles = parsePastorTitles(user?.sub_role);
  if (titles.length) groups.push({ key: 'pastor', label: 'Pastoral', icon: 'fa-cross', chips: titles });
  return groups;
}

/** "Singer (PAW): Song Leader · Media: Lyrics" */
export const summarizeGroups = (groups) => groups
  .map((g) => [g.label, g.chips.join(', ')].filter(Boolean).join(': '))
  .filter(Boolean)
  .join(' · ');

/**
 * What `user` loses by going from the roles they hold to `nextRoles`. Each
 * detail stays while any held role owns it; one no role owns any more is
 * cleared, so a Church Member is never left holding a Song Leader's place in
 * the lineup.
 * @param {string[]} nextRoles - every role the account will hold afterwards
 * @returns {{ updates: object, removed: { label: string, value: string, note?: string }[] }}
 *   updates are the columns to clear; removed describes them for the confirmation.
 */
export function getRoleSetEffects(user, nextRoles) {
  const updates = {};
  const removed = [];
  const tokens = splitSubRole(user?.sub_role);
  const titles = tokens.filter((t) => PASTOR_TITLES.includes(t));
  const ministryTokens = tokens.filter((t) => !PASTOR_TITLES.includes(t));

  if (!keepsMinistry(nextRoles) && (user?.ministry || ministryTokens.length)) {
    removed.push({
      label: 'Ministry roles',
      value: summarizeGroups(describeMinistry(user?.ministry, ministryTokens.join(', '))),
      note: user?.ministry === PAW ? 'They will be taken off the Praise & Worship lineups.' : undefined,
    });
    updates.ministry = null;
  }
  if (!keepsPastorTitles(nextRoles) && titles.length) removed.push({ label: 'Pastor titles', value: titles.join(', ') });

  const kept = [
    ...(keepsMinistry(nextRoles) ? ministryTokens : []),
    ...(keepsPastorTitles(nextRoles) ? titles : []),
  ];
  if (kept.length !== tokens.length) updates.sub_role = kept.join(', ') || null;

  const eventTypes = user?.allowed_event_types || [];
  if (!canHoldEventPermissions(nextRoles) && eventTypes.length) {
    removed.push({ label: 'Event permissions', value: eventTypes.join(', '), note: 'Their "My Events" page goes away.' });
    updates.allowed_event_types = [];
  }

  return { updates, removed };
}

/**
 * Changing the main role: it replaces the old one. Added roles stay, except
 * the new role itself and a second kind of membership; a Guest keeps none.
 * @returns {{ updates: object, removed: object[], roles: string[] }}
 *   updates include role and additional_roles; roles is every role held after.
 */
export function getRoleChangeEffects(user, newRole) {
  const next = arrangeRoles([newRole, ...additionalRolesFor(newRole, user?.additional_roles || [])]);
  const roles = [next.role, ...next.additional_roles];
  const { updates, removed } = getRoleSetEffects(user, roles);
  const dropped = (user?.additional_roles || []).filter((r) => !roles.includes(r));
  if (dropped.length) removed.push({ label: 'Added roles', value: dropped.join(', ') });
  return { updates: { ...updates, ...next }, removed, roles };
}

/** Taking one of several roles away. The highest left becomes the main role. */
export function getRoleRemovalEffects(user, role) {
  const next = arrangeRoles(getUserRoles(user).filter((r) => r !== role));
  const roles = [next.role, ...next.additional_roles];
  const { updates, removed } = getRoleSetEffects(user, roles);
  return { updates: { ...updates, ...next }, removed, roles };
}

/**
 * May this account open a dashboard section? Strict and by role: see
 * SECTION_ACCESS in lib/permissions.js. Every role held counts.
 */
export const canOpenSection = (user, section) => canAccessSection(section, {
  roles: getUserRoles(user),
  subRole: user?.sub_role,
  ministries: ministriesOf(user?.ministry, user?.sub_role),
  eventTypes: user?.allowed_event_types || [],
});

// ============================================
// DASHBOARDS
// What the dashboard switcher in the sidebar offers: the account's own
// dashboard (named after its roles) and the Event Committee's when the
// account is on the committee.
// ============================================
export const MAIN_DASHBOARD = 'main';
export const COMMITTEE_DASHBOARD = 'event-committee';
export const DASHBOARD_KEYS = [MAIN_DASHBOARD, COMMITTEE_DASHBOARD];

/**
 * @param {object} user - the signed-in account
 * @param {boolean} onCommittee - whether the Event Committee dashboard opens for them
 * @returns {{ key: string, title: string, group: string, icon: string, external?: boolean }[]}
 */
export function getUserDashboards(user, onCommittee) {
  const dashboards = [{ key: MAIN_DASHBOARD, title: getUserRoles(user).join(' · ') || ROLES.GUEST, group: 'Member Dashboard', icon: 'fa-house' }];
  if (onCommittee) dashboards.push({ key: COMMITTEE_DASHBOARD, title: 'Event Committee', group: 'Committee Dashboard', icon: 'fa-people-group', external: true });
  return dashboards;
}
