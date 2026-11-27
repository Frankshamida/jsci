// Joyful Cares - how each ministry member is doing, worked out from what the
// app already keeps. SERVER ONLY (the service role key).
//
//   check-ins    attendance: the ministry app (GPS), RFID cards, marked by hand
//   duties       the lineups (schedules): who was down to serve on a Sunday,
//                and its practice day; kept by NAME, matched to accounts here
//   excuses      lineup_excuses, with the member's own reason
//   substitutes  lineup_substitutes, with the reason
//   care         care_people and care_notes: what the Pastors have done
//
// A day counts only when check-ins were taken that day at all (somebody
// checked in): a Sunday nobody recorded says nothing about anybody. And a
// member who has never checked in once in the whole window is shown as such,
// not as "absent 12 Sundays in a row": they may simply not use check-in.

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';
import { MINISTRY_ROLES, parseMinistryCards, LINEUP_INSTRUMENTS } from '@/lib/userRoles';
import { churchDate, addDays } from '@/lib/ministryApp';
import { CARE_WINDOW_WEEKS, CARE_RECENT_DAYS, RULES, STATUSES } from '@/lib/joyfulCares';

const HERE = ['Present', 'Late'];
// The accounts that serve in a ministry (the retired roles too).
const MEMBER_ROLES = ['Ministry Member', 'Member', 'Song Leader', 'Leader'];
const PAGE = 1000;
const DAY = 86400000;

const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const manilaDay = (iso) => (iso
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  : null);
const fullName = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim();
const pct = (r) => `${Math.round(r * 100)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const latest = (...isos) => isos.filter(Boolean).sort().pop() || null;

export const careTablesMissing = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205'
  || (/care_(people|notes)/.test(String(error.message || '')) && /does not exist|schema cache|not find/i.test(String(error.message || ''))));

async function readAll(build) {
  const rows = [];
  for (let from = 0; from < 100 * PAGE; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// A read that may fail on its own without taking the page down.
async function optional(name, fn) {
  try { return await fn(); } catch (error) {
    console.error(`joyful cares: ${name}:`, error?.message || error);
    return [];
  }
}

const bucket = (map, key) => { if (!map.has(key)) map.set(key, []); return map.get(key); };
const setOf = (map, key) => { if (!map.has(key)) map.set(key, new Set()); return map.get(key); };

// Everyone on one lineup: lower-case name -> the parts they have.
function lineupNames(row) {
  const out = new Map();
  const add = (name, part) => {
    const k = String(typeof name === 'string' ? name : name?.name || '').trim().toLowerCase();
    if (k) out.set(k, [...(out.get(k) || []), part]);
  };
  add(row.song_leader, 'Song leader');
  (Array.isArray(row.backup_singers) ? row.backup_singers : []).forEach((n) => add(n, 'Backup singer'));
  LINEUP_INSTRUMENTS.forEach(({ token, label }) => (row.musicians?.[token] || []).forEach((n) => add(n, label)));
  (Array.isArray(row.dancers) ? row.dancers : []).forEach((n) => add(n, 'Dancer'));
  return out;
}

/**
 * Everything Joyful Cares shows, for every ministry member.
 * @returns {Promise<object>} { today, members, ministries, pastors, totals, tablesReady, raw }
 */
export async function loadCare() {
  const today = churchDate();
  const start = addDays(today, -7 * CARE_WINDOW_WEEKS);
  const recentStart = addDays(today, -CARE_RECENT_DAYS);

  const users = await readAll(() => supabaseAdmin.from('users')
    .select('id, firstname, lastname, role, additional_roles, ministry, sub_role, status, is_active, created_at, profile_picture')
    .neq('is_active', false).order('id'));
  const pastors = users.filter((u) => getUserRoles(u).includes('Pastor'));

  let tablesReady = true;
  const [attendance, schedules, excuses, subs, carePeople, messages] = await Promise.all([
    readAll(() => supabaseAdmin.from('attendance').select('id, user_id, event_date, status')
      .gte('event_date', start).lte('event_date', today).order('id')),
    optional('schedules', () => readAll(() => supabaseAdmin.from('schedules')
      .select('id, schedule_date, practice_date, song_leader, backup_singers, musicians, dancers, status')
      .gte('schedule_date', start).lte('schedule_date', addDays(today, 14)).order('id'))),
    optional('excuses', () => readAll(() => supabaseAdmin.from('lineup_excuses')
      .select('id, user_id, excuse_date, reason, status, created_at').gte('excuse_date', start).order('id'))),
    optional('substitutes', () => readAll(() => supabaseAdmin.from('lineup_substitutes')
      .select('id, requester_id, schedule_date, reason, status, created_at').gte('schedule_date', start).order('id'))),
    (async () => {
      try { return await readAll(() => supabaseAdmin.from('care_people').select('*').order('member_id')); } catch (error) {
        if (careTablesMissing(error)) { tablesReady = false; return []; }
        throw error;
      }
    })(),
    pastors.length ? optional('messages', () => readAll(() => supabaseAdmin.from('messages')
      .select('id, receiver_id, created_at').in('sender_id', pastors.map((p) => p.id)).eq('is_broadcast', false)
      .gte('created_at', new Date(Date.now() - 120 * DAY).toISOString()).order('id'))) : [],
  ]);

  // ---- Who is who ----
  const nameToId = new Map();
  const clash = new Set();
  users.forEach((u) => {
    const k = fullName(u).toLowerCase();
    if (!k) return;
    if (nameToId.has(k)) clash.add(k); else nameToId.set(k, u.id);
  });
  clash.forEach((k) => nameToId.delete(k));
  const care = new Map(carePeople.map((c) => [c.member_id, c]));
  const lastMessage = new Map();
  messages.forEach((m) => { if (!lastMessage.has(m.receiver_id) || lastMessage.get(m.receiver_id) < m.created_at) lastMessage.set(m.receiver_id, m.created_at); });

  // ---- Check-ins ----
  const checkins = new Map();   // user -> Set(date)
  const excusedOn = new Map();  // user -> Set(date): marked Excused, or an approved excuse
  const takenDays = new Set();  // days anybody checked in
  attendance.forEach((r) => {
    if (HERE.includes(r.status)) { takenDays.add(r.event_date); setOf(checkins, r.user_id).add(r.event_date); } else if (r.status === 'Excused') setOf(excusedOn, r.user_id).add(r.event_date);
  });
  const excusesBy = new Map();
  excuses.forEach((e) => {
    bucket(excusesBy, e.user_id).push(e);
    if (e.status === 'Approved') setOf(excusedOn, e.user_id).add(e.excuse_date);
  });
  const subsBy = new Map();
  subs.forEach((s) => bucket(subsBy, s.requester_id).push(s));
  const takenSundays = [...takenDays].filter((d) => weekday(d) === 0 && d < today).sort().reverse();

  // ---- Duties: who was down to serve, and on which practice day ----
  const duties = new Map();      // user -> [{ date, parts }]
  const practices = new Map();   // user -> [date]
  const upcoming = new Map();    // user -> [{ date, parts }]
  schedules.filter((s) => !s.status || s.status === 'Active').forEach((s) => {
    lineupNames(s).forEach((parts, name) => {
      const id = nameToId.get(name);
      if (!id) return;
      if (s.schedule_date < today) bucket(duties, id).push({ date: s.schedule_date, parts });
      else bucket(upcoming, id).push({ date: s.schedule_date, parts });
      if (s.practice_date && s.practice_date < today) bucket(practices, id).push(s.practice_date);
    });
  });

  // ---- Each member ----
  const members = [];
  users.forEach((u) => {
    if (!getUserRoles(u).some((r) => MEMBER_ROLES.includes(r))) return;
    const cards = parseMinistryCards(u.ministry, u.sub_role).cards;
    if (!cards.length) return;
    const ministries = cards.map((c) => {
      const mr = MINISTRY_ROLES.find((m) => m.key === c.key);
      return { key: c.key, title: mr?.title || c.key, group: mr?.group || '', icon: mr?.icon || 'fa-users', positions: c.positions || [], head: !!c.head };
    });

    const cp = care.get(u.id) || null;
    const joined = manilaDay(u.created_at) || start;
    const cleared = cp?.cleared_at ? manilaDay(cp.cleared_at) : null;
    const counts = (d) => d >= joined && (!cleared || d > cleared);
    const mine = checkins.get(u.id) || new Set();
    const excused = excusedOn.get(u.id) || new Set();

    const sundays = takenSundays.filter((d) => d >= joined);
    let streak = 0;
    for (const d of sundays) {
      if (cleared && d <= cleared) break;
      if (mine.has(d)) break;
      if (excused.has(d)) continue;
      streak += 1;
    }
    const last8 = sundays.slice(0, 8);
    const prev8 = sundays.slice(8, 16);
    const rateOf = (list) => (list.length ? list.filter((d) => mine.has(d)).length / list.length : null);
    const rate8 = rateOf(last8);
    const ratePrev = rateOf(prev8);

    const missedDuties = (duties.get(u.id) || []).filter((x) => takenDays.has(x.date) && !mine.has(x.date) && !excused.has(x.date) && counts(x.date));
    const missedDuties30 = missedDuties.filter((x) => x.date >= recentStart).length;
    const missedPractices30 = (practices.get(u.id) || []).filter((d) => takenDays.has(d) && !mine.has(d) && counts(d) && d >= recentStart).length;
    const myExcuses = (excusesBy.get(u.id) || []).slice().sort((a, b) => (a.excuse_date < b.excuse_date ? 1 : -1));
    const excuses30 = myExcuses.filter((e) => e.excuse_date >= recentStart || (manilaDay(e.created_at) || '') >= recentStart).length;
    const mySubs = (subsBy.get(u.id) || []).slice().sort((a, b) => (a.schedule_date < b.schedule_date ? 1 : -1));
    const subs30 = mySubs.filter((s) => s.schedule_date >= recentStart).length;
    const lastCheckIn = [...mine].sort().pop() || null;
    const lastContact = latest(cp?.last_contacted_at, lastMessage.get(u.id));
    const newMember = joined >= recentStart;
    const neverChecksIn = mine.size === 0 && sundays.length >= 4 && !(cleared && cleared >= sundays[0]);

    // ---- Rules ----
    const follow = [];
    const watch = [];
    if (neverChecksIn) {
      watch.push(`No check-ins in the last ${CARE_WINDOW_WEEKS} weeks (they may not be using check-in)`);
    } else {
      if (streak >= RULES.followStreak) follow.push(`Not checked in for ${streak} Sundays in a row`);
      else if (streak >= RULES.watchStreak) watch.push(`Not checked in for ${streak} Sundays in a row`);
      if (missedDuties30 >= RULES.followDuties) follow.push(`Missed ${plural(missedDuties30, 'lineup duty', 'lineup duties')} in ${CARE_RECENT_DAYS} days`);
      else if (missedDuties30 >= RULES.watchDuties) watch.push(`Missed a lineup duty in the last ${CARE_RECENT_DAYS} days`);
      if (missedPractices30 >= RULES.watchPractices) watch.push(`Missed ${plural(missedPractices30, 'practice')} in ${CARE_RECENT_DAYS} days`);
      if (ratePrev != null && rate8 != null && prev8.length >= 4 && last8.length >= 4 && ratePrev >= 0.5 && rate8 <= ratePrev / 2) {
        watch.push(`Sunday attendance down from ${pct(ratePrev)} to ${pct(rate8)}`);
      }
    }
    if (excuses30 >= RULES.watchExcuses) watch.push(`Sent ${plural(excuses30, 'excuse')} in ${CARE_RECENT_DAYS} days`);
    if (subs30 >= RULES.watchSubs) watch.push(`Asked for a substitute ${plural(subs30, 'time')} in ${CARE_RECENT_DAYS} days`);

    const status = cp?.in_care ? 'care' : follow.length ? 'follow' : watch.length ? 'watch' : 'well';
    members.push({
      id: u.id,
      name: fullName(u) || 'Unnamed',
      firstname: u.firstname || '',
      picture: u.profile_picture || null,
      canMessage: u.status === 'Verified',
      joined,
      ministries,
      status,
      flags: [...follow, ...watch],
      followFlags: follow.length,
      weight: streak * 3 + missedDuties30 * 3 + missedPractices30 + excuses30 + subs30,
      signals: {
        streak, rate8, ratePrev, sundaysCounted: last8.length,
        missedDuties30, missedPractices30, excuses30, subs30,
        lastCheckIn, lastContact, newMember, neverChecksIn,
        daysSinceCheckIn: lastCheckIn ? daysBetween(lastCheckIn, today) : null,
        last8: last8.slice().reverse().map((d) => ({ date: d, here: mine.has(d), excused: excused.has(d) })),
      },
      care: {
        inCare: !!cp?.in_care,
        since: cp?.in_care_since || null,
        assignedTo: cp?.assigned_to || null,
        assignedName: cp?.assigned_name || null,
        followUpOn: cp?.follow_up_on || null,
        clearedAt: cp?.cleared_at || null,
      },
      ai: cp?.ai_at ? {
        summary: cp.ai_summary || '', step: cp.ai_step || '', stepKind: cp.ai_step_kind || 'encourage',
        urgency: cp.ai_urgency || 'low', drafts: cp.ai_drafts || {}, at: cp.ai_at, hash: cp.ai_hash || null,
      } : null,
      // Kept for the member's page and the AI; not sent with the list.
      _detail: { mine, excused, sundays, duties: duties.get(u.id) || [], upcoming: upcoming.get(u.id) || [], excuses: myExcuses, subs: mySubs, missedDuties },
    });
  });

  members.sort((a, b) => STATUSES[a.status].rank - STATUSES[b.status].rank || b.weight - a.weight || a.name.localeCompare(b.name));

  // ---- Each ministry ----
  const lastSundays = takenSundays.slice(0, 8);
  const prevSundays = takenSundays.slice(8, 16);
  const ministries = MINISTRY_ROLES.map((mr) => {
    const list = members.filter((m) => m.ministries.some((x) => x.key === mr.key));
    const rateFor = (days) => {
      let here = 0;
      let possible = 0;
      list.forEach((m) => days.forEach((d) => {
        if (d < m.joined) return;
        possible += 1;
        if (m._detail.mine.has(d)) here += 1;
      }));
      return possible ? here / possible : null;
    };
    const byStatus = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, list.filter((m) => m.status === k).length]));
    return {
      key: mr.key,
      title: mr.title,
      group: mr.group,
      icon: mr.icon,
      members: list.length,
      rate8: rateFor(lastSundays),
      ratePrev: rateFor(prevSundays),
      trend: lastSundays.slice().reverse().map((d) => ({ date: d, rate: rateFor([d]) })),
      excuses30: list.reduce((s, m) => s + m.signals.excuses30, 0),
      missedDuties30: list.reduce((s, m) => s + m.signals.missedDuties30, 0),
      byStatus,
      needs: list.filter((m) => m.status === 'follow').slice(0, 3).map((m) => m.name),
    };
  }).filter((m) => m.members > 0);

  const totals = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, members.filter((m) => m.status === k).length]));
  totals.members = members.length;
  totals.due = members.filter((m) => m.care.inCare && m.care.followUpOn && m.care.followUpOn <= today).length;

  return {
    today,
    windowWeeks: CARE_WINDOW_WEEKS,
    sundaysRecorded: takenSundays.length,
    tablesReady,
    members,
    ministries,
    pastors: pastors.map((p) => ({ id: p.id, name: fullName(p) })).sort((a, b) => a.name.localeCompare(b.name)),
    totals,
  };
}

/** A member as the list sends it (without the working sets). */
export function publicMember(m) {
  const { _detail, ...rest } = m;
  return rest;
}

/** The member's history, newest first, for their page. */
export function timelineOf(m, notes, today) {
  const d = m._detail;
  const events = [];
  d.upcoming.forEach((x) => events.push({ date: x.date, kind: 'upcoming', text: `On the lineup: ${x.parts.join(', ')}` }));
  d.sundays.forEach((day) => {
    if (d.mine.has(day)) events.push({ date: day, kind: 'here', text: 'Checked in at the Sunday service' });
    else if (d.excused.has(day)) events.push({ date: day, kind: 'excused', text: 'Excused from the Sunday service' });
    else events.push({ date: day, kind: 'missed', text: 'No check-in at the Sunday service' });
  });
  const missed = new Set(d.missedDuties.map((x) => x.date));
  d.duties.forEach((x) => events.push({
    date: x.date,
    kind: missed.has(x.date) ? 'duty-missed' : 'duty',
    text: `${missed.has(x.date) ? 'Missed lineup duty' : 'Served on the lineup'}: ${x.parts.join(', ')}`,
  }));
  d.excuses.forEach((e) => events.push({ date: e.excuse_date, kind: 'excuse', text: `Excuse (${String(e.status || 'Pending').toLowerCase()})`, quote: e.reason || '' }));
  d.subs.forEach((s) => events.push({ date: s.schedule_date, kind: 'sub', text: `Asked for a substitute (${String(s.status || '').toLowerCase()})`, quote: s.reason || '' }));
  (notes || []).forEach((n) => events.push({
    date: manilaDay(n.created_at), at: n.created_at, kind: `note-${n.kind}`, text: n.body || '', author: n.author_name || '',
  }));
  // Sunday check-ins after a duty on the same day say the same thing twice.
  const dutyDays = new Set(d.duties.map((x) => x.date));
  return events
    .filter((e) => !(e.kind === 'here' && dutyDays.has(e.date)) && !(e.kind === 'missed' && missed.has(e.date)))
    .filter((e) => e.date && e.date <= addDays(today, 14))
    .sort((a, b) => (a.date === b.date ? String(b.at || '').localeCompare(String(a.at || '')) : a.date < b.date ? 1 : -1));
}

// ---- What the AI is given: no names, no notes the Pastors wrote ----
export function aiInput(m, today) {
  const scrub = (text) => {
    let t = String(text || '').replace(/\S+@\S+\.\S+/g, '[email]').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]');
    [m.firstname, ...(m.name || '').split(/\s+/)].filter((w) => w && w.length > 1).forEach((w) => {
      t = t.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), 'Member A');
    });
    return t.slice(0, 280);
  };
  const ago = (ymd) => (ymd ? `${daysBetween(ymd, today)} days ago` : null);
  const s = m.signals;
  return {
    member: 'Member A',
    ministries: m.ministries.map((x) => `${x.title} (${x.group})${x.head ? ', head' : ''}${x.positions.length ? `: ${x.positions.join(', ')}` : ''}`),
    memberFor: s.newMember ? 'less than a month' : `about ${Math.max(1, Math.round(daysBetween(m.joined, today) / 30))} months`,
    status: STATUSES[m.status].label,
    flaggedBecause: m.flags,
    sundayAttendance: {
      lastEightSundays: s.rate8 == null ? 'not enough data' : pct(s.rate8),
      eightSundaysBefore: s.ratePrev == null ? 'not enough data' : pct(s.ratePrev),
      sundaysMissedInARow: s.streak,
      lastCheckIn: ago(s.lastCheckIn) || `none in ${CARE_WINDOW_WEEKS} weeks`,
      mayNotUseCheckIn: s.neverChecksIn,
    },
    missedLineupDuties30Days: s.missedDuties30,
    missedPractices30Days: s.missedPractices30,
    excuses: m._detail.excuses.slice(0, 6).map((e) => ({ when: ago(e.excuse_date), reason: scrub(e.reason), status: e.status })),
    substituteRequests: m._detail.subs.slice(0, 4).map((x) => ({ when: ago(x.schedule_date), reason: scrub(x.reason), status: x.status })),
    daysSinceAPastorReachedOut: s.lastContact ? daysBetween(manilaDay(s.lastContact), today) : null,
    alreadyInCare: m.care.inCare,
  };
}

// What a suggestion rests on, without anything that changes by itself from one
// day to the next ("5 days ago"): a new one is worth asking for only when this
// changes.
export function basisOf(m) {
  const value = {
    status: m.status,
    flags: m.flags,
    inCare: m.care.inCare,
    excuses: m._detail.excuses.slice(0, 6).map((e) => `${e.id}:${e.status}`),
    subs: m._detail.subs.slice(0, 4).map((x) => `${x.id}:${x.status}`),
  };
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}
