import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { churchDate, addDays } from '@/lib/ministryApp';
import { LINEUP_INSTRUMENTS } from '@/lib/userRoles';
import { openCampaigns } from '@/lib/givingServer';
import { SUNDAY_TIME } from '@/lib/sundayService';
import { loadCare } from '@/lib/joyfulCaresServer';

export const dynamic = 'force-dynamic';
// Every read fresh: force-dynamic alone does not keep Next 14 from caching the
// database reads of a GET-only route.
export const revalidate = 0;

// ============================================================
// GET /api/pastor/overview?actorId=..
// Everything the Pastor's Home shows (components/PastorOverview), in one
// request:
//   sunday      the coming Sunday's lineup and what on it is still open
//   attendance  check-ins on each of the last 12 Sundays (ministry app GPS,
//               RFID card, or marked by hand - the attendance table)
//   care        people to greet: new accounts and birthdays this week
//   cares       Joyful Cares in short: members by status, who needs a
//               follow-up, and each ministry's Sunday attendance
//   meetings, isom, events, drives
// Pastors only (a Super Admin always may). Each part is read on its own, so a
// table that is missing or failing empties its card instead of the page.
// ============================================================

const HERE = ['Present', 'Late'];
const WEEKS = 12;
const NEW_DAYS = 14;
// PostgREST returns at most 1000 rows a request; longer reads go in pages.
const PAGE = 1000;

const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const fullName = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Unnamed';
const manilaMidnight = (ymd) => `${ymd}T00:00:00+08:00`;

// "19:00" -> "7:00 PM"; anything else as typed.
function clock(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return t ? String(t).trim() : null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// Every row a query gives, a page at a time. `build` makes a fresh query.
async function readAll(build) {
  const rows = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// A card's data, or its fallback and a note when its read fails.
async function part(name, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    console.error(`pastor overview: ${name}:`, error?.message || error);
    return fallback;
  }
}

const person = (u, extra = {}) => ({
  id: u.id,
  name: fullName(u),
  picture: u.profile_picture || null,
  ministry: u.ministry || null,
  // Chat lists Verified accounts only, so only they can be messaged.
  canMessage: u.status === 'Verified',
  ...extra,
});

// ---- The coming Sunday's lineup ----
async function sundayPart(sunday) {
  const { data: row, error } = await supabaseAdmin
    .from('schedules').select('*').eq('schedule_date', sunday).maybeSingle();
  if (error) throw error;
  if (!row || (row.status && row.status !== 'Active')) return { date: sunday, time: SUNDAY_TIME, lineup: null };

  // A song is { title, link, instructions }; the planner can leave blank ones.
  const titles = (list) => (Array.isArray(list) ? list : [])
    .map((s) => (typeof s === 'string' ? s : s?.title || '').trim()).filter(Boolean);
  const slowSongs = titles(row.slow_songs);
  const fastSongs = titles(row.fast_songs);
  const slow = slowSongs.length;
  const fast = fastSongs.length;
  const singers = Array.isArray(row.backup_singers) ? row.backup_singers.filter(Boolean) : [];
  const dancers = Array.isArray(row.dancers) ? row.dancers.filter(Boolean) : [];
  const playing = LINEUP_INSTRUMENTS.filter(({ token }) => (row.musicians?.[token] || []).some(Boolean));
  const open = LINEUP_INSTRUMENTS.filter((i) => !playing.includes(i));
  const players = LINEUP_INSTRUMENTS.reduce((n, { token }) => n + (row.musicians?.[token] || []).filter(Boolean).length, 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const items = [
    {
      key: 'leader', label: 'Song leader', ready: !!row.song_leader,
      detail: row.song_leader || 'Nobody yet',
    },
    {
      key: 'songs', label: 'Songs', ready: slow + fast > 0,
      detail: slow + fast > 0 ? `${plural(slow + fast, 'song', 'songs')} · ${slow} slow, ${fast} fast` : 'No songs picked yet',
    },
    {
      key: 'singers', label: 'Backup singers', ready: singers.length > 0,
      detail: singers.length ? plural(singers.length, 'singer', 'singers') : 'Nobody yet',
    },
    {
      key: 'musicians', label: 'Musicians', ready: players > 0,
      detail: players === 0 ? 'Nobody yet'
        : open.length ? `${plural(players, 'player', 'players')} · no ${open.map((i) => i.label).join(', ')}`
          : `${plural(players, 'player', 'players')} · every instrument`,
    },
    {
      key: 'dancers', label: 'Dancers', ready: dancers.length > 0,
      detail: dancers.length ? plural(dancers.length, 'dancer', 'dancers') : 'Nobody yet',
    },
    {
      key: 'practice', label: 'Practice', ready: !!row.practice_date,
      detail: row.practice_date
        ? [new Date(`${row.practice_date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }), clock(row.practice_time)].filter(Boolean).join(' · ')
        : 'No practice set',
    },
  ];
  // Everyone and every song, for the printable lineup sheet.
  const sheet = {
    songLeader: row.song_leader || null,
    backupSingers: singers,
    musicians: LINEUP_INSTRUMENTS.map(({ token, label }) => ({ instrument: label, names: (row.musicians?.[token] || []).filter(Boolean) })),
    dancers,
    slowSongs,
    fastSongs,
    practice: items.find((i) => i.key === 'practice').ready ? items.find((i) => i.key === 'practice').detail : null,
  };
  return { date: sunday, time: SUNDAY_TIME, lineup: { items, ready: items.filter((i) => i.ready).length, total: items.length, sheet } };
}

// ---- Check-ins on the last 12 Sundays ----
// (Who has stopped coming is Joyful Cares' work: see caresPart.)
async function attendancePart(lastSunday, today) {
  const sundays = Array.from({ length: WEEKS }, (_, i) => addDays(lastSunday, -7 * (WEEKS - 1 - i)));
  const rows = await readAll(() => supabaseAdmin
    .from('attendance').select('id, user_id, event_date, status')
    .in('event_date', sundays).in('status', HERE).order('id'));

  const bySunday = new Map(sundays.map((d) => [d, new Set()]));
  rows.forEach((r) => { if (r.user_id) bySunday.get(r.event_date)?.add(r.user_id); });
  const weeks = sundays.map((d) => ({ date: d, count: bySunday.get(d).size }));
  const recordedSundays = sundays.filter((d) => d < today && bySunday.get(d).size > 0).length;
  return { weeks, recordedSundays };
}

// ---- Joyful Cares in short ----
async function caresPart(today) {
  const data = await loadCare();
  const pick = (m) => ({
    id: m.id, name: m.name, firstname: m.firstname, picture: m.picture, status: m.status,
    flags: m.flags, ministries: m.ministries.map((x) => x.title), canMessage: m.canMessage,
    followUpOn: m.care.followUpOn, assignedName: m.care.assignedName,
  });
  return {
    tablesReady: data.tablesReady,
    totals: data.totals,
    overdue: data.members.filter((m) => m.care.inCare && m.care.followUpOn && m.care.followUpOn < today).length,
    // Most pressing first (loadCare sorts them so).
    flagged: data.members.filter((m) => m.status !== 'well').slice(0, 40).map(pick),
    ministries: data.ministries.map((m) => ({
      key: m.key, title: m.title, group: m.group, icon: m.icon, members: m.members,
      rate8: m.rate8, ratePrev: m.ratePrev, follow: m.byStatus.follow,
    })),
  };
}

// ---- Birthdays from today through 6 days on ----
function birthdaysFrom(users, today) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return users
    .filter((u) => /^\d{4}-\d{2}-\d{2}/.test(String(u.birthdate || '')))
    .map((u) => {
      let md = String(u.birthdate).slice(5, 10);
      // Born on Feb 29: Feb 28 in a year without one.
      if (md === '02-29' && !leap(Number(today.slice(0, 4)))) md = '02-28';
      const on = days.find((d) => d.slice(5) === md);
      return on ? person(u, { on }) : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.name.localeCompare(b.name)));
}

async function meetingsPart() {
  const { data, error } = await supabaseAdmin
    .from('ministry_meetings').select('id, title, ministry, meeting_date, location, status')
    .gte('meeting_date', new Date().toISOString()).eq('status', 'Scheduled')
    .order('meeting_date', { ascending: true }).limit(4);
  if (error) throw error;
  const meetings = data || [];
  if (!meetings.length) return [];
  const { data: rsvps, error: rErr } = await supabaseAdmin
    .from('meeting_rsvps').select('meeting_id, status').in('meeting_id', meetings.map((m) => m.id));
  if (rErr) throw rErr;
  return meetings.map((m) => {
    const mine = (rsvps || []).filter((r) => r.meeting_id === m.id);
    return {
      id: m.id, title: m.title, ministry: m.ministry, at: m.meeting_date, location: m.location || null,
      going: mine.filter((r) => r.status === 'Going').length,
      maybe: mine.filter((r) => r.status === 'Maybe').length,
    };
  });
}

async function isomPart() {
  const { count, error } = await supabaseAdmin
    .from('isom_inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new');
  if (error) throw error;
  return { waiting: count || 0 };
}

async function eventsPart() {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('events').select('id, title, event_date, end_date, location, max_participants, registration_required, is_active, is_published')
    .or(`event_date.gte."${now}",end_date.gte."${now}"`)
    .order('event_date', { ascending: true }).limit(12);
  if (error) throw error;
  const events = (data || []).filter((e) => e.is_active !== false && e.is_published !== false).slice(0, 3);
  const regCount = async (id, statuses) => {
    let q = supabaseAdmin.from('event_registrations').select('id', { count: 'exact', head: true })
      .eq('event_id', id).is('deleted_at', null);
    q = statuses ? q.in('status', statuses) : q.neq('status', 'cancelled');
    const { count, error: cErr } = await q;
    if (cErr) throw cErr;
    return count || 0;
  };
  return Promise.all(events.map(async (e) => {
    const takesRegistrations = e.registration_required !== false;
    const [registered, toCheck] = takesRegistrations
      ? await Promise.all([regCount(e.id), regCount(e.id, ['payment_submitted'])])
      : [0, 0];
    return {
      id: e.id, title: e.title, at: e.event_date, location: e.location || null,
      takesRegistrations, registered, toCheck,
      capacity: Number(e.max_participants) > 0 ? Number(e.max_participants) : null,
    };
  }));
}

async function drivesPart() {
  return (await openCampaigns()).slice(0, 3).map((c) => ({
    id: c.id, slug: c.slug, title: c.title, raised: c.raised, gifts: c.gifts,
    goal: c.goal_amount, endsOn: c.ends_on,
  }));
}

export async function GET(request) {
  const actorId = new URL(request.url).searchParams.get('actorId');
  const who = await requireRole(actorId, ['Pastor']);
  if (who.error) return NextResponse.json({ success: false, message: who.error }, { status: who.status });

  const today = churchDate();
  const dow = weekday(today);
  // The service a pastor is getting ready for (today, on a Sunday) and the
  // last one people could check in at (also today, on a Sunday).
  const nextSunday = dow === 0 ? today : addDays(today, 7 - dow);
  const lastSunday = dow === 0 ? today : addDays(today, -dow);

  // Active accounts, once: new accounts and birthdays come from here.
  const users = await part('users', () => readAll(() => supabaseAdmin
    .from('users').select('id, firstname, lastname, ministry, role, status, is_active, created_at, birthdate, profile_picture')
    .neq('is_active', false).order('id')), []);

  const since = new Date(manilaMidnight(addDays(today, -(NEW_DAYS - 1)))).getTime();
  const newPeople = users
    .filter((u) => u.created_at && new Date(u.created_at).getTime() >= since)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((u) => person(u, { joined: u.created_at, role: u.role || null, verified: u.status === 'Verified' }));

  const [sunday, attendance, cares, meetings, isom, events, drives] = await Promise.all([
    part('sunday', () => sundayPart(nextSunday), { date: nextSunday, time: SUNDAY_TIME, lineup: null, failed: true }),
    part('attendance', () => attendancePart(lastSunday, today), { weeks: [], recordedSundays: 0, failed: true }),
    part('cares', () => caresPart(today), null),
    part('meetings', meetingsPart, null),
    part('isom', isomPart, null),
    part('events', eventsPart, null),
    part('drives', drivesPart, null),
  ]);

  return NextResponse.json({
    success: true,
    today,
    firstname: who.user.firstname || '',
    sunday: { ...sunday, daysAway: Math.round((Date.parse(nextSunday) - Date.parse(today)) / 86400000) },
    attendance: { weeks: attendance.weeks, recordedSundays: attendance.recordedSundays, failed: !!attendance.failed },
    care: {
      newPeople: newPeople.slice(0, 30),
      newCount: newPeople.length,
      unverifiedNew: newPeople.filter((p) => !p.verified).length,
      birthdays: birthdaysFrom(users, today),
      newDays: NEW_DAYS,
    },
    cares, meetings, isom, events, drives,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
