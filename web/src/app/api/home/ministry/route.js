import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { USER_FIELDS, fullNameOf } from '@/lib/ministryAuth';
import { getUserRoles, ROLES, LEGACY_ROLES } from '@/lib/permissions';
import { parseMinistryCards, describeRoleDetails, lineupParts, LINEUP_INSTRUMENTS } from '@/lib/userRoles';
import { churchDate, addDays, coverableRoleTypes, canPlot, canEditLyrics } from '@/lib/ministryApp';
import { loadMonth, pictureMap, sundaysBetween, monthRange } from '@/lib/ministrySchedule';
import { matchLyrics, titleKey } from '@/lib/ministryLyrics';

export const dynamic = 'force-dynamic';
// Every read fresh: force-dynamic alone does not keep Next 14 from caching the
// database reads of a GET-only route.
export const revalidate = 0;

// ============================================================
// GET /api/home/ministry?actorId=..
// Everything a Ministry Member's Home shows (components/home/MinistryOverview),
// in one request. What comes back depends on what they serve as:
//   me          their positions: Song Leader, Keyboard, Head Dancer, ...
//   days        their own next Sundays: serving, rest, excused, not plotted
//   lineups     the next lineups, with songs and who is on them
//   requests    open subs they can take, swaps waiting for them, their own
//               open excuses and sub requests
//   checkins    their Sunday check-ins, the last 8 Sundays
//   history     the last 6 months of lineups: songs they led, songs they
//               know, how many Sundays each person served
//   plotter     (Schedule Plotter) approvals waiting, months plotted
//   media       (Media team) lyrics library, songs needing lyrics, recordings
//   ushers      (Ushers) the events they usher; a Head Usher, every usher's
//               check-ins and the ushers on each event
// Each part is read on its own: a table that is missing or failing empties
// its card instead of the page.
// ============================================================

const HERE = ['Present', 'Late'];
const OPEN_SUB = ['Pending Admin', 'Open for Sub'];
const MEDIA_ORDER = ['Media Head', 'Lyrics', 'Media Live', 'Graphics', 'Technical', 'Social Media'];
// A Ministry Member, or a retired role that became one.
const MINISTRY = [ROLES.MINISTRY_MEMBER, LEGACY_ROLES.SONG_LEADER, LEGACY_ROLES.LEADER];
const isMinistry = (roles) => roles.some((r) => MINISTRY.includes(r));
const lc = (s) => String(s || '').trim().toLowerCase();
const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

function monthAfter(ym, n = 1) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const lastMonths = (today, n) => Array.from({ length: n }, (_, i) => monthAfter(today.slice(0, 7), i - (n - 1)));

async function part(name, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`ministry home: ${name}:`, error?.message || error);
    return null;
  }
}

// Their positions as words: "Song Leader", "Keyboard", "Head Dancer", ...
function positionsOf(user) {
  return describeRoleDetails(user)
    .filter((g) => g.key !== 'pastor')
    .flatMap((g) => {
      if (g.key === 'plotter') return ['Schedule Plotter'];
      if (!g.chips.length) return [g.label];
      return g.chips.map((c) => (c === 'Regular dancer' ? 'Dancer' : c === 'Regular usher' ? 'Usher' : c));
    })
    .filter(Boolean);
}

// The songs of a lineup, fast first (the order they are sung).
const songsOf = (l) => [
  ...(l.fastSongs || []).map((s) => ({ title: s.title, link: s.link || '', type: 'Fast' })),
  ...(l.slowSongs || []).map((s) => ({ title: s.title, link: s.link || '', type: 'Slow' })),
].filter((s) => s.title);

// The active, verified accounts that hold one ministry role ('media', 'usher').
async function membersWith(key) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id, firstname, lastname, role, additional_roles, ministry, sub_role')
    .eq('is_active', true).eq('status', 'Verified');
  if (error) throw error;
  return (data || [])
    .filter((u) => isMinistry(getUserRoles(u)))
    .map((u) => ({ u, card: parseMinistryCards(u.ministry, u.sub_role).cards.find((c) => c.key === key) }))
    .filter((x) => x.card)
    .map(({ u, card }) => ({ id: u.id, name: fullNameOf(u), positions: card.positions, head: card.head }));
}

export async function GET(request) {
  const actorId = new URL(request.url).searchParams.get('actorId');
  if (!actorId) return bad('Please sign in first.', 401);
  const { data: user, error: userError } = await supabaseAdmin.from('users').select(USER_FIELDS).eq('id', String(actorId)).maybeSingle();
  if (userError || !user || user.is_active === false) return bad('Please sign in again.', 401);
  const roles = getUserRoles(user);
  if (!isMinistry(roles) && !roles.includes(ROLES.SUPER_ADMIN)) return bad('This Home is for ministry members.', 403);

  try {
    const today = churchDate();
    const name = fullNameOf(user);
    const key = lc(name);
    const { cards } = parseMinistryCards(user.ministry, user.sub_role);
    const card = (k) => cards.find((c) => c.key === k);
    const singer = card('singer');
    const musician = card('musician');
    const media = card('media');
    const me = {
      id: user.id,
      name,
      firstname: user.firstname,
      keys: cards.map((c) => c.key),
      positions: positionsOf(user),
      songLeader: !!singer?.positions.includes('Song Leaders'),
      backupSinger: !!singer?.positions.includes('Backup Singer'),
      musicDirector: !!musician?.positions.includes('Music Director'),
      instruments: LINEUP_INSTRUMENTS.filter((i) => musician?.positions.includes(i.token)).map((i) => i.label),
      dancer: !!card('dancer'),
      headDancer: !!card('dancer')?.head,
      media: media ? media.positions : null,
      mediaHead: !!media?.positions.includes('Media Head'),
      usher: !!card('usher'),
      headUsher: !!card('usher')?.head,
      plotter: canPlot(user),
      lyrics: canEditLyrics(user),
      coverable: coverableRoleTypes(user.sub_role),
    };
    const onLineups = me.keys.some((k) => k === 'singer' || k === 'musician' || k === 'dancer');

    const thisMonth = today.slice(0, 7);
    const nextMonth = monthAfter(thisMonth);
    const pictures = await pictureMap();
    const lastSundays = sundaysBetween(addDays(today, -56), addDays(today, -1)).slice(-8);

    const [months, hist, openSubs, swapsForMe, mine, attendance] = await Promise.all([
      part('months', () => Promise.all([loadMonth(user, thisMonth, pictures), loadMonth(user, nextMonth, pictures)])),
      part('history', async () => {
        const { data, error } = await supabase.from('schedules')
          .select('schedule_date, song_leader, backup_singers, musicians, dancers, slow_songs, fast_songs')
          .gte('schedule_date', addDays(today, -183)).lte('schedule_date', addDays(today, 42))
          .order('schedule_date', { ascending: true });
        if (error) throw error;
        return data || [];
      }),
      part('open subs', async () => {
        if (!me.coverable.length) return [];
        const { data, error } = await supabase.from('lineup_substitutes').select('id, schedule_date, role_type, requester_id, requester_name, reason')
          .eq('status', 'Open for Sub').neq('requester_id', user.id).in('role_type', me.coverable).gte('schedule_date', today)
          .order('schedule_date', { ascending: true }).limit(10);
        if (error) throw error;
        return (data || []).map((s) => ({ id: s.id, date: s.schedule_date, roleType: s.role_type || 'Song Leader', from: s.requester_name, reason: s.reason || '' }));
      }),
      // lineup_swaps exists once the 1.3 migration has run; before that, none.
      part('swaps', async () => {
        const { data, error } = await supabaseAdmin.from('lineup_swaps').select('*')
          .eq('partner_id', user.id).eq('status', 'Waiting Partner');
        if (error) return [];
        return (data || []).filter((w) => w.requester_date >= today && w.partner_date >= today)
          .map((w) => ({ id: w.id, from: w.requester_name, theirDate: w.requester_date, myDate: w.partner_date, part: w.part || '' }));
      }),
      part('my requests', async () => {
        const [ex, subs] = await Promise.all([
          supabase.from('lineup_excuses').select('id, excuse_date, status, role_type').eq('user_id', user.id).gte('excuse_date', today).in('status', ['Pending', 'Approved']),
          supabase.from('lineup_substitutes').select('id, schedule_date, status, role_type, substitute_name').eq('requester_id', user.id).gte('schedule_date', today).in('status', [...OPEN_SUB, 'Accepted']),
        ]);
        return {
          excuses: (ex.data || []).map((e) => ({ id: e.id, date: e.excuse_date, status: e.status, roleType: e.role_type })),
          subs: (subs.data || []).map((s) => ({ id: s.id, date: s.schedule_date, status: s.status, roleType: s.role_type || 'Song Leader', by: s.substitute_name || null })),
        };
      }),
      part('attendance', async () => {
        const { data, error } = await supabase.from('attendance').select('event_date, status')
          .eq('user_id', user.id).gte('event_date', `${monthAfter(thisMonth, -5)}-01`).lte('event_date', today);
        if (error) throw error;
        return data || [];
      }),
    ]);

    // ---- Their next Sundays and the next lineups ----
    const [m1, m2] = months || [{ days: [], lineups: [] }, { days: [], lineups: [] }];
    const days = [...m1.days, ...m2.days].filter((d) => d.date >= today).slice(0, 6);
    const lineups = [...m1.lineups, ...m2.lineups].filter((l) => l.date >= today).slice(0, 5)
      .map((l) => ({ ...l, songs: songsOf(l) }));

    // ---- Check-ins ----
    const att = attendance || [];
    const checkins = {
      sundays: lastSundays.map((d) => ({ date: d, status: att.find((a) => a.event_date === d)?.status || null })),
      byMonth: lastMonths(today, 6).map((m) => ({ month: m, count: att.filter((a) => a.event_date.startsWith(m) && HERE.includes(a.status)).length })),
    };

    // ---- History: what they led and know, and how often each person served ----
    const rows = hist || [];
    const pastRows = rows.filter((s) => s.schedule_date < today);
    const recentFrom = addDays(today, -91);
    const served = { singers: {}, musicians: {}, dancers: {} };
    const ledSongs = {};
    const knownSongs = new Set();
    const dancedSongs = {};
    const servedByMonth = Object.fromEntries(lastMonths(today, 6).map((m) => [m, 0]));
    rows.forEach((s) => {
      const parts = lineupParts({ songLeader: s.song_leader, backupSingers: s.backup_singers, musicians: s.musicians, dancers: s.dancers });
      const past = s.schedule_date < today;
      if (s.schedule_date >= recentFrom) {
        Object.values(parts).forEach((p) => {
          p.parts.forEach((pt) => {
            const group = pt === 'Song Leader' || pt === 'Backup Singer' ? 'singers' : pt === 'Dancer' ? 'dancers' : 'musicians';
            served[group][p.name] = (served[group][p.name] || 0) + 1;
          });
        });
      }
      if (!past) return;
      const mineHere = parts[key]?.parts || [];
      const songs = [...(s.fast_songs || []), ...(s.slow_songs || [])].filter((x) => x?.title);
      if (mineHere.length) {
        songs.forEach((x) => knownSongs.add(titleKey(x.title)));
        const m = s.schedule_date.slice(0, 7);
        if (m in servedByMonth) servedByMonth[m] += 1;
      }
      if (mineHere.includes('Song Leader')) {
        songs.forEach((x) => {
          const k = titleKey(x.title);
          ledSongs[k] = { title: ledSongs[k]?.title || x.title, count: (ledSongs[k]?.count || 0) + 1 };
        });
      }
      if ((s.dancers || []).length) {
        (s.fast_songs || []).filter((x) => x?.title).forEach((x) => {
          const k = titleKey(x.title);
          dancedSongs[k] = (dancedSongs[k] || 0) + 1;
        });
      }
    });
    const top = (obj, n = 8) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([who, count]) => ({ name: who, count }));
    const history = {
      servedFrom: recentFrom,
      servedTo: addDays(today, 42),
      singers: top(served.singers),
      musicians: top(served.musicians),
      dancers: top(served.dancers),
      ledSongs: Object.values(ledSongs).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)).slice(0, 6),
      servedByMonth: Object.entries(servedByMonth).map(([month, count]) => ({ month, count })),
      hadHistory: pastRows.length > 0,
    };
    // Each upcoming song: new to them? danced before (for the dance team)?
    lineups.forEach((l) => {
      l.songs = l.songs.map((s) => ({ ...s, newToMe: history.hadHistory && !knownSongs.has(titleKey(s.title)), danced: dancedSongs[titleKey(s.title)] || 0 }));
    });

    // ---- Schedule Plotter ----
    let plotter = null;
    if (me.plotter) {
      plotter = await part('plotter', async () => {
        const [ex, subs, swaps, nextRows] = await Promise.all([
          supabase.from('lineup_excuses').select('id, user_name, excuse_date, role_type').eq('status', 'Pending').gte('excuse_date', addDays(today, -7)).order('excuse_date', { ascending: true }),
          supabase.from('lineup_substitutes').select('id, requester_name, substitute_name, schedule_date, role_type').eq('status', 'Pending Admin').order('schedule_date', { ascending: true }),
          supabaseAdmin.from('lineup_swaps').select('id, requester_name, partner_name, requester_date, partner_date, part').eq('status', 'Pending Approval').order('requester_date', { ascending: true }),
          supabase.from('schedules').select('schedule_date').gte('schedule_date', monthRange(thisMonth).from).lte('schedule_date', monthRange(monthAfter(thisMonth, 2)).to),
        ]);
        const approvals = [
          ...(swaps.error ? [] : swaps.data || []).map((w) => ({ kind: 'swap', id: w.id, date: w.requester_date, title: `${w.requester_name} ⇄ ${w.partner_name}`, sub: [w.part, `${w.requester_date} and ${w.partner_date}`].filter(Boolean).join(' · '), dates: [w.requester_date, w.partner_date] })),
          ...(subs.data || []).map((s) => ({ kind: 'sub', id: s.id, date: s.schedule_date, title: s.substitute_name ? `${s.substitute_name} covers ${s.requester_name}` : `${s.requester_name} asks for a sub`, sub: s.role_type || 'Song Leader', dates: [s.schedule_date] })),
          ...(ex.data || []).map((e) => ({ kind: 'excuse', id: e.id, date: e.excuse_date, title: `${e.user_name} asks to be excused`, sub: e.role_type || '', dates: [e.excuse_date] })),
        ].sort((a, b) => a.date.localeCompare(b.date));
        const plotted = new Set((nextRows.data || []).map((r) => r.schedule_date));
        const monthsPlotted = [thisMonth, nextMonth, monthAfter(thisMonth, 2)].map((m) => {
          const { from, to } = monthRange(m);
          const sundays = sundaysBetween(from, to);
          return { month: m, sundays: sundays.length, plotted: sundays.filter((d) => plotted.has(d)).length };
        });
        return { approvals, months: monthsPlotted };
      });
    }

    // ---- Media team ----
    let mediaPart = null;
    if (me.media) {
      mediaPart = await part('media', async () => {
        const lastSunday = sundaysBetween(addDays(today, -7), addDays(today, -1))[0] || null;
        const [index, recent, yearCount, team] = await Promise.all([
          supabase.from('lyrics_library').select('id, title, youtube_link, status, linked_schedule_dates, updated_at, created_at'),
          supabase.from('recordings').select('id, title, recording_date, uploaded_by_name, created_at').order('recording_date', { ascending: false, nullsFirst: false }).limit(5),
          supabase.from('recordings').select('id', { count: 'exact', head: true }).gte('recording_date', `${today.slice(0, 4)}-01-01`),
          me.mediaHead ? membersWith('media') : Promise.resolve(null),
        ]);
        const library = index.error ? [] : index.data || [];
        const coverage = lineups.map((l) => {
          const songs = l.songs.map((s) => ({ title: s.title, type: s.type, ready: !!matchLyrics(s, library, l.date) }));
          return { date: l.date, leader: l.songLeader?.name || null, songs };
        });
        const needing = coverage.flatMap((c) => c.songs.filter((s) => !s.ready).map((s) => ({ ...s, date: c.date, leader: c.leader })));
        const added = Object.fromEntries(lastMonths(today, 6).map((m) => [m, 0]));
        library.forEach((r) => { const m = String(r.created_at || '').slice(0, 7); if (m in added) added[m] += 1; });
        const recordings = recent.error ? [] : recent.data || [];
        return {
          libraryCount: library.length,
          addedByMonth: Object.entries(added).map(([month, count]) => ({ month, count })),
          coverage,
          needing,
          recordings: recordings.map((r) => ({ id: r.id, title: r.title, date: r.recording_date, by: r.uploaded_by_name || null })),
          recordingsThisYear: yearCount.error ? null : yearCount.count || 0,
          lastSunday,
          lastSundayRecorded: lastSunday ? recordings.some((r) => r.recording_date === lastSunday) : null,
          team: team ? MEDIA_ORDER.map((p) => ({ position: p, names: team.filter((t) => t.positions.includes(p)).map((t) => t.name) })).filter((g) => g.names.length) : null,
          teamSize: team ? team.length : null,
        };
      });
    }

    // ---- Ushers ----
    let ushers = null;
    if (me.usher) {
      ushers = await part('ushers', async () => {
        const { data: assigned, error } = await supabaseAdmin.from('committee_assignments').select('user_id, event_id, roles');
        const usherRows = error ? [] : (assigned || []).filter((a) => Array.isArray(a.roles) && a.roles.some((r) => lc(r) === 'usher'));
        const { data: events } = await supabaseAdmin.from('events').select('id, title, event_date, end_date, is_published')
          .eq('is_active', true).gte('event_date', addDays(today, -1)).lte('event_date', addDays(today, 75))
          .order('event_date', { ascending: true }).limit(30);
        const upcoming = (events || []).filter((e) => (e.end_date || e.event_date) >= today);
        const byEvent = (id) => usherRows.filter((a) => a.event_id === id);
        const mineEvents = upcoming.filter((e) => byEvent(e.id).some((a) => a.user_id === user.id))
          .map((e) => ({ id: e.id, title: e.title, date: e.event_date, endDate: e.end_date || null }));
        let team = null;
        let eventsUshers = null;
        let perSunday = null;
        if (me.headUsher) {
          const members = await membersWith('usher');
          const ids = members.map((m) => m.id);
          const { data: rowsAtt } = ids.length
            ? await supabase.from('attendance').select('user_id, event_date, status').in('user_id', ids).in('event_date', lastSundays)
            : { data: [] };
          const present = (rowsAtt || []).filter((r) => HERE.includes(r.status));
          team = members.map((m) => ({ name: m.name, head: m.head, count: present.filter((r) => r.user_id === m.id).length }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
          perSunday = lastSundays.map((d) => ({ date: d, count: present.filter((r) => r.event_date === d).length }));
          eventsUshers = upcoming.filter((e) => e.is_published !== false).slice(0, 6)
            .map((e) => ({ id: e.id, title: e.title, date: e.event_date, endDate: e.end_date || null, ushers: byEvent(e.id).length }));
        }
        return { mine: mineEvents, team, teamSize: team ? team.length : null, events: eventsUshers, perSunday, sundays: lastSundays.length };
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        today,
        me,
        onLineups,
        days,
        lineups,
        requests: {
          openSubs: openSubs || [],
          swapsForMe: swapsForMe || [],
          excuses: mine?.excuses || [],
          subs: mine?.subs || [],
        },
        checkins,
        history,
        plotter,
        media: mediaPart,
        ushers,
      },
    });
  } catch (error) {
    console.error('GET /api/home/ministry error:', error);
    return bad('Could not load your Home. Please try again.', 500);
  }
}
