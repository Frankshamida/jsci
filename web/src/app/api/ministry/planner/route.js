import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf, internalJson } from '@/lib/ministryAuth';
import { canPlot, churchDate } from '@/lib/ministryApp';
import { splitSubRole } from '@/lib/permissions';
import { LINEUP_INSTRUMENTS } from '@/lib/userRoles';
import { POST as createSchedule, PUT as updateSchedule, DELETE as deleteSchedule } from '@/app/api/schedules/route';

// ============================================================
// JSCI Ministry app - the Schedule Plotter's month
//   GET     ?month=YYYY-MM (or ?scheduleId=)  the month's lineups, who can
//           be plotted, and who is excused
//   POST    plot a new lineup
//   PUT     change who is on a lineup, or its dates (never its songs)
//   DELETE  ?scheduleId=  remove a lineup
// The saving itself is the website's /api/schedules, so the Monthly Planner
// and the app follow the same rules (one person, one part; one lineup a date).
// ============================================================

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PER_PART = 15;
const TOKENS = LINEUP_INSTRUMENTS.map((i) => i.token);
const INSTRUMENT_LABEL = Object.fromEntries(LINEUP_INSTRUMENTS.map((i) => [i.token, i.label]));

const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

// The signed-in Ministry Member, when they may plot.
async function plotter(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth;
  // 400, not 403: the app reads a 403 as "your session ended" and signs out.
  if (!canPlot(auth.user)) return { response: bad('Only the Schedule Plotter can do this.', 400) };
  return auth;
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return { first: `${month}-01`, last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

function sundaysOf(month) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const shapeLineup = (s) => ({
  scheduleId: s.schedule_id,
  date: s.schedule_date,
  practiceDate: s.practice_date || null,
  practiceTime: s.practice_time || null,
  songLeader: s.song_leader || null,
  backupSingers: s.backup_singers || [],
  musicians: Object.fromEntries(TOKENS.map((t) => [t, s.musicians?.[t] || []])),
  dancers: s.dancers || [],
  songCount: (s.slow_songs || []).length + (s.fast_songs || []).length,
  hasSubstitute: !!s.original_song_leader,
});

// Who can be put in each part: the same lists as the website's Monthly Planner
// (/api/lineup/singers), so nobody is plottable in one and not the other.
async function plottablePeople() {
  const base = () => supabase.from('users')
    .select('id, firstname, lastname, sub_role, profile_picture')
    .eq('is_active', true).eq('status', 'Verified').eq('ministry', 'Praise And Worship')
    .order('firstname', { ascending: true });
  const [leaders, backups, musicians, dancers] = await Promise.all([
    base().ilike('sub_role', '%Song Leaders%'),
    base().ilike('sub_role', '%Backup Singer%'),
    base().ilike('sub_role', '%Instrumentalist%'),
    base().ilike('sub_role', '%Dancer%'),
  ]);
  const err = leaders.error || backups.error || musicians.error || dancers.error;
  if (err) throw err;
  const person = (u) => ({ id: u.id, name: `${u.firstname} ${u.lastname}`.trim(), picture: u.profile_picture || null });
  return {
    songLeaders: (leaders.data || []).map(person),
    backupSingers: (backups.data || []).map(person),
    musicians: (musicians.data || []).map((u) => ({ ...person(u), instruments: TOKENS.filter((t) => splitSubRole(u.sub_role).includes(t)) })),
    dancers: (dancers.data || []).map(person),
  };
}

// ---- GET ----
export async function GET(request) {
  const auth = await plotter(request);
  if (auth.response) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const today = churchDate();
    let month = params.get('month') || today.slice(0, 7);
    const scheduleId = params.get('scheduleId');
    if (scheduleId) {
      const { data: one } = await supabase.from('schedules').select('schedule_date').eq('schedule_id', scheduleId).maybeSingle();
      if (!one) return bad('Lineup not found.', 404);
      month = one.schedule_date.slice(0, 7);
    }
    if (!MONTH.test(month)) return bad('Pick a month.');
    const { first, last } = monthBounds(month);

    const [schedules, excuses, people] = await Promise.all([
      supabase.from('schedules').select('*').gte('schedule_date', first).lte('schedule_date', last).order('schedule_date', { ascending: true }),
      supabase.from('lineup_excuses').select('user_id, user_name, excuse_date, status, role_type')
        .gte('excuse_date', first).lte('excuse_date', last).in('status', ['Pending', 'Approved']),
      plottablePeople(),
    ]);
    if (schedules.error) throw schedules.error;

    return NextResponse.json({
      success: true,
      data: {
        month,
        today,
        sundays: sundaysOf(month),
        lineups: (schedules.data || []).map(shapeLineup),
        people,
        excuses: (excuses.data || []).map((e) => ({ userId: e.user_id, name: e.user_name, date: e.excuse_date, status: e.status, roleType: e.role_type || 'Song Leader' })),
      },
    });
  } catch (error) {
    console.error('GET /api/ministry/planner error:', error);
    return bad('Could not load the month. Pull down to try again.', 500);
  }
}

// ---- Checking what is sent ----

// Each name must be somebody who can take that part (or was already in it on
// this lineup, so an old lineup with a since-renamed singer can still be edited).
// Returns { names } in their saved spelling, or { error }.
function checkNames(sent, candidates, keep, what) {
  const known = new Map();
  [...candidates.map((p) => p.name), ...(keep || [])].forEach((n) => known.set(String(n).trim().toLowerCase(), String(n).trim()));
  const list = (Array.isArray(sent) ? sent : []).map((n) => String(n || '').trim()).filter(Boolean);
  if (list.length > MAX_PER_PART) return { error: `Too many in ${what} (${MAX_PER_PART} at most).` };
  const names = [];
  for (const n of list) {
    const name = known.get(n.toLowerCase());
    if (!name) return { error: `${n} cannot be put in ${what}. Pick from the list.` };
    if (!names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return { names };
}

async function readLineup(body, existing) {
  const date = String(body.date || existing?.schedule_date || '');
  if (!DAY.test(date)) return { error: 'Pick the date of the lineup.' };
  const practiceDate = body.practiceDate ? String(body.practiceDate) : null;
  if (practiceDate && !DAY.test(practiceDate)) return { error: 'Pick a practice date.' };
  if (practiceDate && practiceDate > date) return { error: 'Practice has to be on or before the lineup date.' };
  const practiceTime = String(body.practiceTime || '').trim().slice(0, 20) || null;

  const people = await plottablePeople();
  const leader = checkNames(body.songLeader ? [body.songLeader] : [], people.songLeaders, existing?.song_leader ? [existing.song_leader] : [], 'Song Leader');
  if (leader.error) return leader;
  if (!leader.names.length) return { error: 'Pick the Song Leader.' };
  const backups = checkNames(body.backupSingers, people.backupSingers, existing?.backup_singers, 'Backup Singers');
  if (backups.error) return backups;
  const musicians = {};
  for (const token of TOKENS) {
    const players = people.musicians.filter((m) => m.instruments.includes(token));
    const checked = checkNames(body.musicians?.[token], players, existing?.musicians?.[token], INSTRUMENT_LABEL[token]);
    if (checked.error) return checked;
    musicians[token] = checked.names;
  }
  const dancers = checkNames(body.dancers, people.dancers, existing?.dancers, 'Dancers');
  if (dancers.error) return dancers;

  const songLeader = leader.names[0];
  return {
    lineup: { date, practiceDate, practiceTime, songLeader, backupSingers: backups.names, musicians, dancers: dancers.names },
    songLeaderId: people.songLeaders.find((p) => p.name.toLowerCase() === songLeader.toLowerCase())?.id || null,
  };
}

// ---- POST ----
export async function POST(request) {
  const auth = await plotter(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const read = await readLineup(body, null);
    if (read.error) return bad(read.error);
    const { lineup, songLeaderId } = read;

    const { data: taken } = await supabase.from('schedules').select('schedule_id').eq('schedule_date', lineup.date).maybeSingle();
    if (taken) return bad(`There is already a lineup on ${longDate(lineup.date)}. Edit that one instead.`, 409);

    return createSchedule(internalJson('/api/schedules', 'POST', {
      songLeader: lineup.songLeader,
      backupSingers: lineup.backupSingers,
      musicians: lineup.musicians,
      dancers: lineup.dancers,
      scheduleDate: lineup.date,
      practiceDate: lineup.practiceDate,
      practiceTime: lineup.practiceTime,
      submittedBy: fullNameOf(auth.user),
      songLeaderId,
    }));
  } catch (error) {
    console.error('POST /api/ministry/planner error:', error);
    return bad('Could not save the lineup. Try again.', 500);
  }
}

// ---- PUT ----
export async function PUT(request) {
  const auth = await plotter(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const { data: existing } = await supabase.from('schedules').select('*').eq('schedule_id', body.scheduleId || '').maybeSingle();
    if (!existing) return bad('Lineup not found. It may have been removed.', 404);

    const read = await readLineup(body, existing);
    if (read.error) return bad(read.error);
    const { lineup, songLeaderId } = read;

    if (lineup.date !== existing.schedule_date) {
      const { data: taken } = await supabase.from('schedules').select('schedule_id').eq('schedule_date', lineup.date).maybeSingle();
      if (taken) return bad(`There is already a lineup on ${longDate(lineup.date)}. Pick another date.`, 409);
    }

    const leaderChanged = String(existing.song_leader || '').toLowerCase() !== lineup.songLeader.toLowerCase();
    return updateSchedule(internalJson('/api/schedules', 'PUT', {
      scheduleId: existing.schedule_id,
      songLeader: lineup.songLeader,
      backupSingers: lineup.backupSingers,
      musicians: lineup.musicians,
      dancers: lineup.dancers,
      scheduleDate: lineup.date,
      practiceDate: lineup.practiceDate,
      practiceTime: lineup.practiceTime,
      songLeaderId,
      notifyLeader: leaderChanged && !!songLeaderId,
    }));
  } catch (error) {
    console.error('PUT /api/ministry/planner error:', error);
    return bad('Could not save the lineup. Try again.', 500);
  }
}

// ---- DELETE ----
export async function DELETE(request) {
  const auth = await plotter(request);
  if (auth.response) return auth.response;
  const scheduleId = new URL(request.url).searchParams.get('scheduleId');
  const { data: existing } = await supabase.from('schedules').select('schedule_id').eq('schedule_id', scheduleId || '').maybeSingle();
  if (!existing) return bad('Lineup not found. It may have been removed already.', 404);
  return deleteSchedule(internalJson(`/api/schedules?scheduleId=${encodeURIComponent(existing.schedule_id)}`, 'DELETE'));
}
