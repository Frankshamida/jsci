import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { shapeLineup, ministryKeys, churchDate, addDays } from '@/lib/ministryApp';
import { limit, tooManyRequests } from '@/lib/rateLimiter';

// ============================================================
// JSCI Ministry app - attendance by GPS
// On a service or practice day, a Ministry Member at church marks themself
// present from the app. The phone sends where it is; the server works out
// the distance to the church itself and allows it only within 1.5 km.
//
// GET   today's event, who of its lineup (and the Media team) is already
//       here, your own check-in, and your attendance history
// POST  { latitude, longitude, accuracy }  check in
// ============================================================

const CHURCH = {
  latitude: 10.319767311613345,
  longitude: 123.8992883502071,
  radiusM: 1500,
  name: 'Joyful Sound Church International',
};

const HERE = ['Present', 'Late'];
const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

// Metres between two points on the earth (haversine).
function distanceM(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const isSunday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay() === 0;
const nextSunday = (ymd) => { let d = addDays(ymd, 1); while (!isSunday(d)) d = addDays(d, 1); return d; };

// "19:00" (the website's time box) -> "7:00 PM". Anything else is shown as typed.
function clock(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return t ? String(t).trim() : null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

const kmText = (m) => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;

/**
 * Today's service or practice, and the next one after today.
 *   a lineup on today              -> Sunday Service
 *   a lineup practising today      -> Practice
 *   a Sunday with no lineup        -> Sunday Service (nobody plotted)
 * @returns {{ event, eventRow, nextEvent }}
 */
async function eventsAround(today) {
  // A practice comes before its Sunday, so every upcoming practice belongs to
  // a lineup from today on.
  const { data, error } = await supabase.from('schedules').select('*').gte('schedule_date', today)
    .order('schedule_date', { ascending: true }).limit(12);
  if (error) throw error;
  const rows = data || [];

  const shape = (type, date, row) => ({
    type,
    date,
    time: type === 'Practice' ? clock(row?.practice_time) : null,
    scheduleId: row?.schedule_id || null,
  });

  let event = null;
  let eventRow = null;
  const service = rows.find((r) => r.schedule_date === today);
  const practice = rows.find((r) => r.practice_date === today);
  if (service) { event = shape('Sunday Service', today, service); eventRow = service; }
  else if (practice) { event = shape('Practice', today, practice); eventRow = practice; }
  else if (isSunday(today)) event = shape('Sunday Service', today, null);

  // The nearest one after today: a lineup's Sunday or practice, or else the next Sunday.
  const later = [];
  rows.forEach((r) => {
    if (r.schedule_date > today) later.push(shape('Sunday Service', r.schedule_date, r));
    if (r.practice_date && r.practice_date > today) later.push(shape('Practice', r.practice_date, r));
  });
  const sunday = nextSunday(today);
  if (!later.some((e) => e.date === sunday && e.type === 'Sunday Service')) later.push(shape('Sunday Service', sunday, null));
  // Same day: the service before its practice would be odd, but a practice first reads right.
  later.sort((a, b) => (a.date === b.date ? (a.type === 'Practice' ? -1 : 1) : a.date < b.date ? -1 : 1));

  return { event, eventRow, nextEvent: later[0] || null };
}

// An attendance row as the app reads it. The GPS columns exist once the
// ministry_app_v1_3 migration has run; before that they are simply empty.
const shapeRecord = (r) => ({
  id: r.id,
  date: r.event_date,
  status: r.status,
  sessionType: r.session_type || null,
  checkedInAt: r.checked_in_at || (r.source === 'gps' || /GPS/i.test(r.notes || '') ? r.created_at : null),
  distanceM: r.distance_m ?? null,
  notes: r.notes || null,
});

// GET - Today at church: the event, who is here, and your history.
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const today = churchDate();
    const [{ event, eventRow, nextEvent }, people, todays, mine] = await Promise.all([
      eventsAround(today),
      supabase.from('users').select('id, firstname, lastname, profile_picture, ministry, sub_role')
        .eq('is_active', true).eq('status', 'Verified')
        .or('ministry.not.is.null,sub_role.not.is.null'),
      supabaseAdmin.from('attendance').select('*').eq('event_date', today),
      supabaseAdmin.from('attendance').select('*').eq('user_id', user.id).order('event_date', { ascending: false }).limit(60),
    ]);
    if (people.error) throw people.error;

    const users = people.data || [];
    // Somebody checked in today who is not in the list above (no ministry saved).
    const known = new Set(users.map((u) => u.id));
    const missing = [...new Set((todays.data || []).map((r) => r.user_id).filter((id) => id && !known.has(id)))];
    if (missing.length) {
      const { data: extra } = await supabase.from('users').select('id, firstname, lastname, profile_picture, ministry, sub_role').in('id', missing);
      users.push(...(extra || []));
    }

    const nameOf = new Map(users.map((u) => [u.id, fullNameOf(u)]));
    const pictures = {};
    users.forEach((u) => { if (u.profile_picture) pictures[fullNameOf(u).toLowerCase()] = u.profile_picture; });

    // Who is here today, by lower-case full name.
    const hereBy = new Map();
    (todays.data || []).forEach((r) => {
      const name = nameOf.get(r.user_id);
      if (!name || !HERE.includes(r.status)) return;
      hereBy.set(name.toLowerCase(), { checkedInAt: r.checked_in_at || r.created_at, userId: r.user_id });
    });

    const listed = new Set();
    const entry = (p, part) => {
      const key = p.name.toLowerCase();
      listed.add(key);
      const here = hereBy.get(key);
      return { name: p.name, picture: p.picture || pictures[key] || null, part, here: !!here, checkedInAt: here?.checkedInAt || null };
    };

    const roster = [];
    if (event) {
      if (eventRow) {
        const l = shapeLineup(eventRow, user, pictures);
        roster.push(
          { key: 'leader', title: 'Song Leader', people: l.songLeader ? [entry(l.songLeader, 'Song Leader')] : [] },
          { key: 'backup', title: 'Backup Singers', people: l.backupSingers.map((p) => entry(p, 'Backup Singer')) },
          { key: 'musicians', title: 'Musicians', people: l.musicians.map((p) => entry(p, p.instrument)) },
          { key: 'dancers', title: 'Dancers', people: l.dancers.map((p) => entry(p, 'Dancer')) },
        );
      }
      // Media is not on the lineup, so the whole Media team is listed.
      const media = users
        .filter((u) => !listed.has(fullNameOf(u).toLowerCase()) && ministryKeys(u).includes('media'))
        .sort((a, b) => fullNameOf(a).localeCompare(fullNameOf(b)))
        .map((u) => entry({ name: fullNameOf(u), picture: u.profile_picture }, 'Media'));
      roster.push({ key: 'media', title: 'Media', people: media });

      // Anybody else who checked in (ushers, a teammate not plotted today).
      const others = [...hereBy.entries()]
        .filter(([key]) => !listed.has(key))
        .map(([key, v]) => ({ name: nameOf.get(v.userId) || key, picture: pictures[key] || null, part: 'Here', here: true, checkedInAt: v.checkedInAt }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (others.length) roster.push({ key: 'others', title: 'Also here', people: others });
    }
    const all = roster.flatMap((g) => g.people);

    const myToday = (todays.data || []).find((r) => r.user_id === user.id) || null;
    return NextResponse.json({
      success: true,
      data: {
        church: CHURCH,
        today,
        event,
        nextEvent,
        me: myToday
          ? { status: myToday.status, checkedInAt: shapeRecord(myToday).checkedInAt || myToday.created_at, distanceM: myToday.distance_m ?? null, sessionType: myToday.session_type || event?.type || null }
          : null,
        roster: roster.filter((g) => g.people.length),
        counts: { here: all.filter((p) => p.here).length, total: all.length },
        history: (mine.data || []).map(shapeRecord),
      },
    });
  } catch (error) {
    console.error('GET /api/ministry/attendance error:', error);
    return bad('Could not load attendance. Pull down to try again.', 500);
  }
}

// POST - Check yourself in: { latitude, longitude, accuracy }.
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const attempt = await limit(`ministry-attendance:${user.id}`, 10, 10 * 60 * 1000);
  if (!attempt.allowed) return tooManyRequests(attempt.retryAfterSec, 'Too many tries. Wait a few minutes and try again.');

  let body;
  try { body = await request.json(); } catch { return bad('Send your location.'); }
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const accuracy = body?.accuracy == null ? null : Number(body.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return bad('Your location could not be read. Turn on location and try again.');
  }
  if (accuracy != null && Number.isFinite(accuracy) && accuracy > CHURCH.radiusM) {
    return bad('Your GPS signal is too weak. Step outside and try again.');
  }

  try {
    const today = churchDate();
    const { event, eventRow } = await eventsAround(today);
    if (!event) return bad('There is no service or practice today. Check-in opens on the day.');

    const distance = Math.round(distanceM(latitude, longitude, CHURCH.latitude, CHURCH.longitude));
    if (distance > CHURCH.radiusM) {
      return bad(`You are ${kmText(distance)} from church. Check-in opens within 1.5 km.`);
    }

    const { data: existing } = await supabaseAdmin.from('attendance').select('id').eq('user_id', user.id).eq('event_date', today).maybeSingle();
    if (existing) return bad("You're already checked in today.", 409);

    const notes = `Checked in with GPS (${event.type}, ${distance} m from church)`;
    const base = {
      user_id: user.id,
      schedule_id: eventRow?.id || null,
      event_date: today,
      status: 'Present',
      marked_by: user.id,
      notes,
    };
    const gps = {
      session_type: event.type,
      checked_in_at: new Date().toISOString(),
      latitude,
      longitude,
      distance_m: distance,
      source: 'gps',
    };

    let { data: record, error } = await supabaseAdmin.from('attendance').insert([{ ...base, ...gps }]).select().single();
    // Before the 1.3 migration the GPS columns are missing: save it without them.
    if (error && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(error.message || ''))) {
      ({ data: record, error } = await supabaseAdmin.from('attendance').insert([base]).select().single());
    }
    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "You're checked in. God bless the service!",
      data: { record: { ...shapeRecord(record), checkedInAt: record.checked_in_at || record.created_at, sessionType: record.session_type || event.type, distanceM: record.distance_m ?? distance } },
    });
  } catch (error) {
    console.error('POST /api/ministry/attendance error:', error);
    return bad('Could not check you in right now. Please try again.', 500);
  }
}
