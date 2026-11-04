import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { LINEUP_INSTRUMENTS } from '@/lib/userRoles';

// Who plays what on a lineup, with their pictures, in instrument order:
// [{ instrument: 'Keyboard', label: 'Keyboard', icon, name, profilePicture }]
function musicianProfiles(schedule, profileMap) {
  return LINEUP_INSTRUMENTS.flatMap(({ token, label, icon }) => (schedule.musicians?.[token] || []).map((name) => ({
    instrument: token, label, icon, name,
    profilePicture: profileMap[name?.toLowerCase()]?.profilePicture || null,
  })));
}

// The instruments `fullName` plays on a lineup.
function instrumentsOf(schedule, fullName) {
  const me = fullName.toLowerCase();
  return LINEUP_INSTRUMENTS.filter(({ token }) => (schedule.musicians?.[token] || []).some((n) => n.toLowerCase().includes(me)))
    .map(({ label }) => label);
}

const dancesOn = (schedule, fullName) => (schedule.dancers || []).some((n) => n.toLowerCase().includes(fullName.toLowerCase()));

const dancerProfiles = (schedule, profileMap) => (schedule.dancers || []).map((name) => ({
  name, profilePicture: profileMap[name?.toLowerCase()]?.profilePicture || null,
}));

// Helper: build a name → profile_picture map from users table
async function getUserProfileMap() {
  const { data: users } = await supabase
    .from('users')
    .select('id, firstname, lastname, profile_picture, sub_role')
    .eq('is_active', true)
    .eq('ministry', 'Praise And Worship');

  const map = {};
  (users || []).forEach(u => {
    const fullName = `${u.firstname} ${u.lastname}`;
    map[fullName.toLowerCase()] = {
      id: u.id,
      name: fullName,
      profilePicture: u.profile_picture || null,
      subRole: u.sub_role || null,
    };
  });
  return map;
}

// GET - Fetch Praise and Worship lineup schedules + member info
// Uses original_song_leader column from schedules table for clean substitute tracking
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') || 'schedules'; // 'schedules' | 'my-schedule' | 'notifications'

    // Fetch all active schedules (upcoming + recent)
    if (type === 'schedules') {
      const { data: schedules, error } = await supabase
        .from('schedules')
        .select('*')
        .order('schedule_date', { ascending: false });

      if (error) throw error;

      // Build profile map for enriching schedule data
      const profileMap = await getUserProfileMap();

      const formatted = (schedules || []).map((s) => {
        const hasSubstitute = !!s.original_song_leader;
        // Enrich song leader profile
        const leaderProfile = profileMap[s.song_leader?.toLowerCase()] || null;
        const originalProfile = hasSubstitute ? (profileMap[s.original_song_leader?.toLowerCase()] || null) : null;
        // Enrich backup singer profiles
        const backupProfiles = (s.backup_singers || []).map(name => {
          const p = profileMap[name?.toLowerCase()];
          return { name, profilePicture: p?.profilePicture || null };
        });

        return {
          scheduleId: s.schedule_id,
          songLeader: s.song_leader,
          songLeaderPicture: leaderProfile?.profilePicture || null,
          backupSingers: s.backup_singers || [],
          backupSingerProfiles: backupProfiles,
          musicianProfiles: musicianProfiles(s, profileMap),
          dancerProfiles: dancerProfiles(s, profileMap),
          scheduleDate: s.schedule_date,
          practiceDate: s.practice_date,
          slowSongs: s.slow_songs || [],
          fastSongs: s.fast_songs || [],
          submittedBy: s.submitted_by,
          status: s.status,
          hasSubstitute,
          originalSongLeader: s.original_song_leader || null,
          originalSongLeaderPicture: originalProfile?.profilePicture || null,
        };
      });

      return NextResponse.json({ success: true, data: formatted });
    }

    // Fetch schedules where user is a backup singer, song leader, substitute, or original leader
    if (type === 'my-schedule' && userId) {
      const { data: user } = await supabase
        .from('users')
        .select('firstname, lastname')
        .eq('id', userId)
        .single();

      if (!user) {
        return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
      }

      const fullName = `${user.firstname} ${user.lastname}`;
      const today = new Date().toISOString().split('T')[0];
      const { data: schedules, error } = await supabase
        .from('schedules')
        .select('*')
        .gte('schedule_date', today)
        .order('schedule_date', { ascending: true });

      if (error) throw error;

      const profileMap = await getUserProfileMap();

      const mySchedules = (schedules || []).filter(s => {
        const backups = s.backup_singers || [];
        const isSongLeader = s.song_leader?.toLowerCase().includes(fullName.toLowerCase());
        const isBackup = backups.some(b => b.toLowerCase().includes(fullName.toLowerCase()));
        const isOriginalLeader = s.original_song_leader?.toLowerCase().includes(fullName.toLowerCase());
        return isSongLeader || isBackup || isOriginalLeader || instrumentsOf(s, fullName).length > 0 || dancesOn(s, fullName);
      }).map(s => {
        const hasSubstitute = !!s.original_song_leader;
        const isBackup = (s.backup_singers || []).some(b => b.toLowerCase().includes(fullName.toLowerCase()));
        const instruments = instrumentsOf(s, fullName);
        // Playing: 'Instrumentalist'; dancing: 'Dancer' - the roles the
        // substitute requests and the excuse calendar already know.
        let role = 'Backup Singer';
        if (!isBackup && instruments.length) role = 'Instrumentalist';
        else if (!isBackup && dancesOn(s, fullName)) role = 'Dancer';
        const isSongLeader = s.song_leader?.toLowerCase().includes(fullName.toLowerCase());
        const isOriginalLeader = s.original_song_leader?.toLowerCase().includes(fullName.toLowerCase());

        if (isSongLeader && hasSubstitute) role = 'Substitute Song Leader';
        else if (isSongLeader) role = 'Song Leader';
        if (isOriginalLeader && hasSubstitute) role = 'Original Song Leader (Substituted)';

        const leaderProfile = profileMap[s.song_leader?.toLowerCase()] || null;
        const originalProfile = hasSubstitute ? (profileMap[s.original_song_leader?.toLowerCase()] || null) : null;
        const backupProfiles = (s.backup_singers || []).map(name => {
          const p = profileMap[name?.toLowerCase()];
          return { name, profilePicture: p?.profilePicture || null };
        });

        return {
          scheduleId: s.schedule_id,
          songLeader: s.song_leader,
          songLeaderPicture: leaderProfile?.profilePicture || null,
          backupSingers: s.backup_singers || [],
          backupSingerProfiles: backupProfiles,
          musicianProfiles: musicianProfiles(s, profileMap),
          dancerProfiles: dancerProfiles(s, profileMap),
          scheduleDate: s.schedule_date,
          practiceDate: s.practice_date,
          slowSongs: s.slow_songs || [],
          fastSongs: s.fast_songs || [],
          submittedBy: s.submitted_by,
          status: s.status,
          role,
          instruments,
          hasSubstitute,
          originalSongLeader: s.original_song_leader || null,
          originalSongLeaderPicture: originalProfile?.profilePicture || null,
        };
      });

      return NextResponse.json({ success: true, data: mySchedules });
    }

    // Fetch notifications for the user related to lineup
    if (type === 'notifications' && userId) {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .in('type', ['lineup', 'substitute', 'praise-worship'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return NextResponse.json({ success: true, data: data || [] });
    }

    return NextResponse.json({ success: false, message: 'Invalid type parameter' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
