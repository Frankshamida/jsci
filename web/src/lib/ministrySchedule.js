// ============================================================
// JSCI Ministry app - the schedule by month
// One month of lineups, with what is happening to each person on them
// (excuse, sub request, covering, swap), and one person's own day-by-day
// status: serving, REST (a lineup without them), excused, covered by a sub,
// or not plotted yet. Home and the month calendar read it; so does a
// teammate's history.
// ============================================================
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { fullNameOf, ministryAccessError, USER_FIELDS } from '@/lib/ministryAuth';
import { shapeLineup, churchDate, addDays } from '@/lib/ministryApp';
import { describeRoleDetails, lineupParts } from '@/lib/userRoles';

const lc = (s) => String(s || '').trim().toLowerCase();
const OPEN_SUB = ['Pending Admin', 'Open for Sub'];
const OPEN_SWAP = ['Waiting Partner', 'Pending Approval'];

/** 'YYYY-MM' -> its first and last day. */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

/** Every Sunday from `from` to `to` (YYYY-MM-DD). */
export function sundaysBetween(from, to) {
  const out = [];
  let d = from;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) d = addDays(d, 1);
  for (; d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

/** Lower-case full name -> profile picture, for every active account. */
export async function pictureMap() {
  const { data } = await supabase.from('users').select('firstname, lastname, profile_picture').eq('is_active', true);
  const map = {};
  (data || []).forEach((p) => { if (p.profile_picture) map[lc(`${p.firstname} ${p.lastname}`)] = p.profile_picture; });
  return map;
}

// Swaps live in a table that exists once the 1.3 migration has run. Before
// that, there are simply none.
async function swapsBetween(from, to) {
  const { data, error } = await supabaseAdmin.from('lineup_swaps').select('*')
    .or(`and(requester_date.gte.${from},requester_date.lte.${to}),and(partner_date.gte.${from},partner_date.lte.${to})`)
    .in('status', [...OPEN_SWAP, 'Approved']);
  return error ? [] : data || [];
}

/**
 * Everything that happens on the lineups between two dates.
 * @returns {Promise<{ schedules, excuses, subs, swaps }>}
 */
async function loadRange(from, to) {
  const [schedules, excuses, subs, swaps] = await Promise.all([
    supabase.from('schedules').select('*').gte('schedule_date', from).lte('schedule_date', to).order('schedule_date', { ascending: true }),
    supabase.from('lineup_excuses').select('id, user_id, user_name, excuse_date, status, role_type, reason').gte('excuse_date', from).lte('excuse_date', to).in('status', ['Pending', 'Approved']),
    supabase.from('lineup_substitutes').select('*').gte('schedule_date', from).lte('schedule_date', to).in('status', [...OPEN_SUB, 'Accepted']),
    swapsBetween(from, to),
  ]);
  if (schedules.error) throw schedules.error;
  return { schedules: schedules.data || [], excuses: excuses.data || [], subs: subs.data || [], swaps };
}

// What is happening to one person on one lineup date.
function personNotes(name, date, { excuses, subs, swaps }) {
  const key = lc(name);
  const notes = {};
  const excuse = excuses.find((e) => e.excuse_date === date && lc(e.user_name) === key);
  if (excuse) notes.excuse = excuse.status;
  const asked = subs.find((s) => s.schedule_date === date && lc(s.requester_name) === key && OPEN_SUB.includes(s.status));
  if (asked) notes.subRequest = asked.status;
  const covering = subs.find((s) => s.schedule_date === date && s.status === 'Accepted' && lc(s.substitute_name) === key);
  if (covering) notes.covering = covering.requester_name;
  const swap = swaps.find((w) => OPEN_SWAP.includes(w.status)
    && ((w.requester_date === date && lc(w.requester_name) === key) || (w.partner_date === date && lc(w.partner_name) === key)));
  if (swap) notes.swap = swap.status;
  return notes;
}

/**
 * A lineup as the app reads it, with notes on each person and the people a
 * substitute replaced (still shown, greyed out, with who covers them).
 */
function annotate(s, user, pictures, range) {
  const l = shapeLineup(s, user, pictures);
  const note = (p) => ({ ...p, ...personNotes(p.name, l.date, range) });
  l.songLeader = l.songLeader ? note(l.songLeader) : null;
  l.backupSingers = l.backupSingers.map(note);
  l.musicians = l.musicians.map(note);
  l.dancers = l.dancers.map(note);
  l.covered = range.subs
    .filter((x) => x.schedule_date === l.date && x.status === 'Accepted' && x.substitute_name)
    .map((x) => ({ roleType: x.role_type || 'Song Leader', name: x.requester_name, picture: pictures[lc(x.requester_name)] || null, by: x.substitute_name }));
  return l;
}

/**
 * One person's status on each date: every Sunday in the range, every lineup
 * date, and any date they filed an excuse for.
 * @param {{ id: string, firstname: string, lastname: string }} subject
 */
function daysFor(subject, from, to, range, attendance = []) {
  const name = lc(fullNameOf(subject));
  const byDate = Object.fromEntries(range.schedules.map((s) => [s.schedule_date, s]));
  const myExcuses = range.excuses.filter((e) => e.user_id === subject.id || lc(e.user_name) === name);
  const dates = [...new Set([
    ...sundaysBetween(from, to),
    ...range.schedules.map((s) => s.schedule_date),
    ...myExcuses.map((e) => e.excuse_date),
  ])].filter((d) => d >= from && d <= to).sort();

  return dates.map((date) => {
    const s = byDate[date];
    const parts = s ? (lineupParts({ songLeader: s.song_leader, backupSingers: s.backup_singers, musicians: s.musicians, dancers: s.dancers })[name]?.parts || []) : [];
    const excuse = myExcuses.find((e) => e.excuse_date === date);
    const asked = range.subs.find((x) => x.schedule_date === date && (x.requester_id === subject.id || lc(x.requester_name) === name));
    const covering = range.subs.find((x) => x.schedule_date === date && x.status === 'Accepted' && (x.substitute_id === subject.id || lc(x.substitute_name) === name));
    // A swap touches both of its dates for both people: on one they give
    // their part away, on the other they take the other person's.
    const swap = range.swaps.find((w) => (w.requester_id === subject.id || w.partner_id === subject.id)
      && (w.requester_date === date || w.partner_date === date));
    const record = attendance.find((a) => a.event_date === date);

    let state = s ? (parts.length ? 'serving' : 'rest') : 'unplotted';
    if (asked?.status === 'Accepted') state = 'covered';
    else if (excuse?.status === 'Approved') state = 'excused';

    return {
      date,
      scheduleId: s?.schedule_id || null,
      plotted: !!s,
      parts,
      state,
      leader: s?.song_leader || null,
      practiceDate: s?.practice_date || null,
      practiceTime: s?.practice_time || null,
      excuse: excuse ? { id: excuse.id, status: excuse.status, roleType: excuse.role_type } : null,
      sub: asked ? { id: asked.id, status: asked.status, roleType: asked.role_type || 'Song Leader', substituteName: asked.substitute_name || null } : null,
      covering: covering && covering.requester_name ? covering.requester_name : null,
      swap: swap ? {
        id: swap.id,
        status: swap.status,
        part: swap.part,
        // 'give': they hand this date over; 'take': they take this date
        direction: (swap.requester_id === subject.id ? swap.requester_date : swap.partner_date) === date ? 'give' : 'take',
        otherName: swap.requester_id === subject.id ? swap.partner_name : swap.requester_name,
        otherDate: swap.requester_id === subject.id ? swap.partner_date : swap.requester_date,
      } : null,
      attendance: record ? record.status : null,
    };
  });
}

/**
 * The month view: its lineups (annotated) and `user`'s day-by-day status.
 * @param {object} user  - the signed-in member (users row)
 * @param {string} month - 'YYYY-MM'
 */
export async function loadMonth(user, month, pictures) {
  const { from, to } = monthRange(month);
  const [range, pics, attendance] = await Promise.all([
    loadRange(from, to),
    pictures ? Promise.resolve(pictures) : pictureMap(),
    supabase.from('attendance').select('event_date, status').eq('user_id', user.id).gte('event_date', from).lte('event_date', to),
  ]);
  return {
    month,
    today: churchDate(),
    lineups: range.schedules.map((s) => annotate(s, user, pics, range)),
    days: daysFor(user, from, to, range, attendance.data || []),
  };
}

/**
 * A teammate's lineup history: every date they were (or are) on, from six
 * months back to three months ahead, newest first. REST days are counted, not listed.
 */
export async function loadHistory(subject) {
  const today = churchDate();
  const from = addDays(today, -183);
  const to = addDays(today, 92);
  const [range, attendance] = await Promise.all([
    loadRange(from, to),
    supabase.from('attendance').select('event_date, status').eq('user_id', subject.id).gte('event_date', from).lte('event_date', to),
  ]);
  const days = daysFor(subject, from, to, range, attendance.data || []).filter((d) => d.plotted || d.excuse);
  const involved = days.filter((d) => d.state !== 'rest' || d.covering);
  return {
    today,
    from,
    to,
    days: involved.reverse(),
    served: days.filter((d) => d.date < today && d.state === 'serving').length,
    rests: days.filter((d) => d.state === 'rest' && !d.covering).length,
  };
}

/**
 * Everyone who uses the app, for searching a teammate by name: their name,
 * picture and ministry roles ("Singer (PAW)": Song Leader, Backup Singer).
 */
export async function loadMembers() {
  const { data } = await supabase.from('users').select(USER_FIELDS).eq('is_active', true).eq('status', 'Verified');
  return (data || [])
    .filter((u) => !ministryAccessError(u))
    .map((u) => ({
      id: u.id,
      name: fullNameOf(u),
      picture: u.profile_picture || null,
      groups: describeRoleDetails(u).filter((g) => g.key !== 'pastor').map((g) => ({ key: g.key || null, label: g.label, positions: g.chips })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
