import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { ministryProfile, shapeLineup, coverableRoleTypes, churchDate, addDays, canPlot } from '@/lib/ministryApp';
import { loadMonth, loadMembers, pictureMap } from '@/lib/ministrySchedule';
import { shapeSwap } from '@/lib/ministrySwaps';
import { getLatestMinistryApp } from '@/lib/ministryAppRelease';

// The swaps table exists once the 1.3 migration has run; until then, none.
const orNone = (p) => p.then((r) => (r.error ? { data: [] } : r));
const countOf = (p) => p.then((r) => (r.error ? 0 : r.count || 0));

// GET - Everything the JSCI Ministry dashboard shows, in one call:
//   profile          who they are, their ministry roles and positions
//   assignments      lineups they are on, from 8 weeks back (newest last)
//   team             the next lineups of the whole team (to see who is on)
//   month            this month: its lineups and their status on each date
//   members          everyone in the app, to search a teammate by name
//   excuses          their excuses
//   substitutes      their sub requests, and the ones they took
//   openSubs         open sub requests they can cover
//   swaps            swaps they asked for or were asked
//   swapsForMe       swaps waiting for their answer
//   pendingApprovals for a Schedule Plotter: excuses, subs and swaps to review
//   attendance       their attendance records
//   latestApp        the newest app version, so the app can say an update is out
// The app caches this and asks again only on pull-to-refresh or after a change.
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const today = churchDate();
    const since = addDays(today, -56);
    const roleTypes = coverableRoleTypes(user.sub_role);
    const plotter = canPlot(user);

    const [schedules, pictures, members, excuses, mySubs, openSubs, swaps, attendance, latest, approvals] = await Promise.all([
      supabase.from('schedules').select('*').gte('schedule_date', since).order('schedule_date', { ascending: true }),
      pictureMap(),
      loadMembers(),
      supabase.from('lineup_excuses').select('id, excuse_date, reason, status, role_type, admin_note, reviewed_by, created_at').eq('user_id', user.id).order('excuse_date', { ascending: false }).limit(60),
      supabase.from('lineup_substitutes').select('*').or(`requester_id.eq.${user.id},substitute_id.eq.${user.id}`).order('schedule_date', { ascending: false }).limit(60),
      roleTypes.length
        ? supabase.from('lineup_substitutes').select('*').eq('status', 'Open for Sub').neq('requester_id', user.id).in('role_type', roleTypes).gte('schedule_date', today).order('schedule_date', { ascending: true })
        : Promise.resolve({ data: [] }),
      orNone(supabaseAdmin.from('lineup_swaps').select('*').or(`requester_id.eq.${user.id},partner_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(60)),
      supabase.from('attendance').select('id, event_date, status, notes').eq('user_id', user.id).order('event_date', { ascending: false }).limit(60),
      getLatestMinistryApp().catch(() => null), // cached on the server; never fails the dashboard
      plotter
        ? Promise.all([
          countOf(supabase.from('lineup_excuses').select('id', { count: 'exact', head: true }).eq('status', 'Pending').gte('excuse_date', addDays(today, -7))),
          countOf(supabase.from('lineup_substitutes').select('id', { count: 'exact', head: true }).eq('status', 'Pending Admin')),
          countOf(supabaseAdmin.from('lineup_swaps').select('id', { count: 'exact', head: true }).eq('status', 'Pending Approval')),
        ])
        : Promise.resolve([0, 0, 0]),
    ]);
    if (schedules.error) throw schedules.error;
    if (user.profile_picture) pictures[fullNameOf(user).toLowerCase()] = user.profile_picture;

    const month = await loadMonth(user, today.slice(0, 7), pictures);
    const lineups = (schedules.data || []).map((s) => shapeLineup(s, user, pictures));
    const assignments = lineups.filter((l) => l.mine);
    // The team's next lineups; this month's (annotated) take their place.
    const annotated = Object.fromEntries(month.lineups.map((l) => [l.scheduleId, l]));
    const team = lineups.filter((l) => l.date >= today).slice(0, 10).map((l) => annotated[l.scheduleId] || l);

    const shapeSub = (s) => ({
      id: s.id,
      date: s.schedule_date,
      scheduleId: s.schedule_id,
      roleType: s.role_type || 'Song Leader',
      status: s.status,
      reason: s.reason,
      requesterId: s.requester_id,
      requesterName: s.requester_name,
      substituteId: s.substitute_id || null,
      substituteName: s.substitute_name || null,
      thankYouSent: !!s.thank_you_sent,
      adminNote: s.admin_note || null,
      createdAt: s.created_at,
    });
    const allSwaps = (swaps.data || []).map(shapeSwap);

    return NextResponse.json({
      success: true,
      data: {
        today,
        profile: ministryProfile(user),
        assignments,
        team,
        month,
        members,
        excuses: excuses.data || [],
        substitutes: (mySubs.data || []).map(shapeSub),
        openSubs: (openSubs.data || []).map(shapeSub),
        swaps: allSwaps,
        swapsForMe: allSwaps.filter((w) => w.partnerId === user.id && w.status === 'Waiting Partner' && w.requesterDate >= today && w.partnerDate >= today),
        pendingApprovals: approvals.reduce((a, b) => a + b, 0),
        attendance: attendance.data || [],
        latestApp: latest
          ? { version: latest.version, apkUrl: latest.apk.url, fileName: latest.apk.name, publishedAt: latest.publishedAt }
          : null,
      },
    });
  } catch (error) {
    console.error('GET /api/ministry/home error:', error);
    return NextResponse.json({ success: false, message: 'Could not load your dashboard. Pull down to try again.' }, { status: 500 });
  }
}
