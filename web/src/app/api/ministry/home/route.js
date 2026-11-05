import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { ministryProfile, shapeLineup, coverableRoleTypes } from '@/lib/ministryApp';
import { getLatestMinistryApp } from '@/lib/ministryAppRelease';

const ymd = (d) => d.toISOString().slice(0, 10);

// GET - Everything the JSCI Ministry dashboard shows, in one call:
//   profile        who they are, their ministry roles and positions
//   assignments    lineups they are on, from 8 weeks back (newest last)
//   team           the next lineups of the whole team (to see who is on)
//   excuses        their excuses
//   substitutes    their sub requests, and the ones they took
//   openSubs       open sub requests they can cover
//   attendance     their attendance records
//   latestApp      the newest app version, so the app can say an update is out
// The app caches this and asks again only on pull-to-refresh or after a change.
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const today = ymd(new Date());
    const since = ymd(new Date(Date.now() - 56 * 24 * 60 * 60 * 1000));
    const roleTypes = coverableRoleTypes(user.sub_role);

    const [schedules, people, excuses, mySubs, openSubs, attendance, latest] = await Promise.all([
      supabase.from('schedules').select('*').gte('schedule_date', since).order('schedule_date', { ascending: true }),
      supabase.from('users').select('firstname, lastname, profile_picture').eq('is_active', true).eq('ministry', 'Praise And Worship'),
      supabase.from('lineup_excuses').select('id, excuse_date, reason, status, role_type, created_at').eq('user_id', user.id).order('excuse_date', { ascending: false }).limit(40),
      supabase.from('lineup_substitutes').select('*').or(`requester_id.eq.${user.id},substitute_id.eq.${user.id}`).order('schedule_date', { ascending: false }).limit(40),
      roleTypes.length
        ? supabase.from('lineup_substitutes').select('*').eq('status', 'Open for Sub').neq('requester_id', user.id).in('role_type', roleTypes).gte('schedule_date', today).order('schedule_date', { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase.from('attendance').select('id, event_date, status, notes').eq('user_id', user.id).order('event_date', { ascending: false }).limit(60),
      getLatestMinistryApp().catch(() => null), // cached on the server; never fails the dashboard
    ]);
    if (schedules.error) throw schedules.error;

    const pictures = {};
    (people.data || []).forEach((p) => { if (p.profile_picture) pictures[`${p.firstname} ${p.lastname}`.toLowerCase()] = p.profile_picture; });
    if (user.profile_picture) pictures[fullNameOf(user).toLowerCase()] = user.profile_picture;

    const lineups = (schedules.data || []).map((s) => shapeLineup(s, user, pictures));
    const assignments = lineups.filter((l) => l.mine);
    const team = lineups.filter((l) => l.date >= today).slice(0, 10);

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
    });

    return NextResponse.json({
      success: true,
      data: {
        today,
        profile: ministryProfile(user),
        assignments,
        team,
        excuses: excuses.data || [],
        substitutes: (mySubs.data || []).map(shapeSub),
        openSubs: (openSubs.data || []).map(shapeSub),
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
