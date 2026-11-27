// Ministry Meetings on the server: who may see, schedule and run a meeting,
// who it is for, and the answers so far.
//
// SERVER ONLY (service-role client).
//
// Who sees a meeting
//   Pastors, Admins and Super Admins: every meeting.
//   Everyone else: meetings for a ministry they serve in, and their own.
// Who may schedule one
//   Anyone with the Create Ministry Meeting permission (team leads), Pastors,
//   Admins and Super Admins.
// Who may change or cancel one
//   The person who set it, Pastors, Admins and Super Admins.
// Who sees the answers
//   Going and Maybe: everyone who sees the meeting (with their photos).
//   Not going and no answer yet: only those who may change the meeting.

import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles, hasPermission, MODULES } from '@/lib/permissions';
import { parseMinistryCards, ministriesOf, canOpenSection } from '@/lib/userRoles';
import { splitMinistries, ministryKey, RSVP_CHOICES } from '@/lib/meetings';

export const STAFF = ['Pastor', 'Admin', 'Super Admin'];
const USER_COLS = 'id, firstname, lastname, profile_picture, role, additional_roles, ministry, sub_role, is_active';

export const fullName = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'A member';
const person = (u) => ({ id: u.id, name: fullName(u), photo: u.profile_picture || null });

/** The signed-in account, or { error, status } with a message fit to show. */
export async function loadActor(actorId) {
  if (!actorId) return { error: 'Please sign in to see meetings.', status: 401 };
  const { data: user, error } = await supabaseAdmin.from('users').select(USER_COLS)
    .eq('id', String(actorId)).maybeSingle();
  if (error || !user || user.is_active === false) {
    return { error: 'Your session has ended. Please sign in again.', status: 401 };
  }
  return { user };
}

export const isStaff = (user) => getUserRoles(user).some((r) => STAFF.includes(r));

export function canSchedule(user) {
  const roles = getUserRoles(user);
  return isStaff(user) || hasPermission(roles, MODULES.CREATE_MINISTRY_MEETING, user?.sub_role);
}

export const canRun = (user, row) => Boolean(user && row && (row.created_by === user.id || isStaff(user)));

// The ministries an account serves in, as ministryKey()s. The ministries table
// has names the account columns do not use ("Dancers", "Back-up"), so the
// ministry roles are read too: a dancer is in Dancers, a backup singer in
// Back-up, an usher in Ashers / Ushers.
export function ministryKeysOf(user) {
  const keys = new Set();
  const add = (n) => { const k = ministryKey(n); if (k) keys.add(k); };
  splitMinistries(user?.ministry).forEach(add);
  ministriesOf(user?.ministry, user?.sub_role).forEach(add);
  const { cards } = parseMinistryCards(user?.ministry, user?.sub_role);
  cards.forEach((c) => {
    if (c.key === 'dancer') add('Dancers');
    if (c.key === 'usher') { add('Ashers'); add('Ushers'); }
    if (c.key === 'media') add('Media');
    if (c.key === 'singer' || c.key === 'musician' || c.key === 'dancer') add('Praise And Worship');
    if (c.key === 'singer' && (c.positions || []).includes('Backup Singer')) add('Back-up');
  });
  return keys;
}

const isFor = (user, row) => {
  const mine = ministryKeysOf(user);
  return splitMinistries(row.ministry).some((m) => mine.has(ministryKey(m)));
};

export const canSee = (user, row) => Boolean(user && row && (isStaff(user) || row.created_by === user.id || isFor(user, row)));

/** Active accounts, by id. Guests are left out of who a meeting is for. */
export async function loadPeople() {
  const { data, error } = await supabaseAdmin.from('users').select(USER_COLS).neq('is_active', false);
  if (error) throw error;
  return data || [];
}

/** Who a meeting is for: active accounts in one of its ministries that can open Ministry Meetings. */
export function invitedTo(row, people) {
  return people.filter((u) => isFor(u, row) && canOpenSection(u, 'ministry-meetings'));
}

/** The answers for these meetings, grouped by meeting id. */
export async function loadRsvps(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabaseAdmin.from('meeting_rsvps')
    .select('meeting_id, user_id, status, created_at').in('meeting_id', ids);
  if (error) throw error;
  const by = new Map();
  (data || []).forEach((r) => { if (!by.has(r.meeting_id)) by.set(r.meeting_id, []); by.get(r.meeting_id).push(r); });
  return by;
}

/** A meeting as the dashboard shows it to `viewer`. */
export function shapeMeeting(row, { viewer, rsvps = [], people = [], byId }) {
  const ids = byId || new Map(people.map((u) => [u.id, u]));
  const run = canRun(viewer, row);
  const answers = rsvps
    .filter((r) => RSVP_CHOICES.includes(r.status) && ids.has(r.user_id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const pick = (s) => answers.filter((r) => r.status === s).map((r) => person(ids.get(r.user_id)));
  const going = pick('Going');
  const maybe = pick('Maybe');
  const notGoing = pick('Not Going');
  const invited = invitedTo(row, people);
  const answered = new Set(answers.map((r) => r.user_id));
  const noReply = invited.filter((u) => !answered.has(u.id)).map(person)
    .sort((a, b) => a.name.localeCompare(b.name));
  const mine = answers.find((r) => r.user_id === viewer?.id);
  const organizer = row.created_by && ids.has(row.created_by) ? person(ids.get(row.created_by)) : null;

  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    ministries: splitMinistries(row.ministry),
    startsAt: row.meeting_date,
    location: row.location || '',
    status: row.status || 'Scheduled',
    organizer: organizer || { id: row.created_by || null, name: row.created_by_name || 'Ministry team', photo: null },
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    myStatus: mine?.status || null,
    canManage: run,
    counts: {
      going: going.length,
      maybe: maybe.length,
      notGoing: notGoing.length,
      invited: invited.length,
      noReply: noReply.length,
    },
    going,
    maybe,
    // Who said no, and who has not answered, only for those running it.
    notGoing: run ? notGoing : [],
    noReply: run ? noReply : [],
  };
}

/** Notices in the bell. A notice that fails never fails the change. */
export async function notify(userIds, { title, message, type = 'info' }) {
  const rows = [...new Set(userIds.filter(Boolean))].map((user_id) => ({
    user_id, title, message, type, link: 'ministry-meetings',
  }));
  if (!rows.length) return 0;
  try {
    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}
