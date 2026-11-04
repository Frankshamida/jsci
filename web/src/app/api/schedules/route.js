import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cleanLineupMusicians, cleanNameList, lineupDoubleBooked } from '@/lib/userRoles';

// One person, one part on a date. Checked on the Monthly Planner's saves
// (the ones that send musicians / dancers), so a Song Leader adding songs to
// a lineup saved before this rule is never blocked by it.
const doubleBooked = ({ songLeader, backupSingers, musicians, dancers }) => {
  if (musicians === undefined && dancers === undefined) return null;
  const doubled = lineupDoubleBooked({ songLeader, backupSingers, musicians, dancers });
  if (!doubled.length) return null;
  const { name, parts } = doubled[0];
  return NextResponse.json({ success: false, message: `${name} has more than one part (${parts.join(', ')}). One person, one part on a date.` }, { status: 400 });
};

// GET all schedules
export async function GET() {
  try {
    const { data: schedules, error } = await supabase
      .from('schedules')
      .select('*')
      .order('schedule_date', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, message: 'Error fetching schedules' }, { status: 500 });
    }

    // Transform to match the old format expected by the frontend
    const formatted = (schedules || []).map((s) => ({
      scheduleId: s.schedule_id,
      songLeader: s.song_leader,
      backupSingers: s.backup_singers || [],
      musicians: s.musicians || {},
      dancers: s.dancers || [],
      scheduleDate: s.schedule_date,
      practiceDate: s.practice_date,
      practiceTime: s.practice_time || null,
      slowSongs: s.slow_songs || [],
      fastSongs: s.fast_songs || [],
      submittedBy: s.submitted_by,
      status: s.status,
      // Substitute tracking — clean, no reason
      hasSubstitute: !!s.original_song_leader,
      originalSongLeader: s.original_song_leader || null,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Get schedules error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}

// POST create a new schedule/lineup
export async function POST(request) {
  try {
    const body = await request.json();
    const { songLeader, backupSingers, musicians, dancers, scheduleDate, practiceDate, practiceTime, slowSongs, fastSongs, submittedBy, songLeaderId } = body;

    if (!songLeader || !scheduleDate) {
      return NextResponse.json({ success: false, message: 'Song leader and schedule date are required' }, { status: 400 });
    }
    const clash = doubleBooked({ songLeader, backupSingers, musicians, dancers });
    if (clash) return clash;

    // Check for duplicate schedule date
    const { data: existing } = await supabase
      .from('schedules')
      .select('id')
      .eq('schedule_date', scheduleDate)
      .single();

    if (existing) {
      return NextResponse.json({ success: false, message: 'A schedule already exists for this date' }, { status: 409 });
    }

    const { data: newSchedule, error } = await supabase
      .from('schedules')
      .insert({
        song_leader: songLeader,
        backup_singers: backupSingers || [],
        // Only when sent (the Monthly Planner), so a lineup made elsewhere
        // still saves on a database without the columns.
        ...(musicians !== undefined && { musicians: cleanLineupMusicians(musicians) }),
        ...(dancers !== undefined && { dancers: cleanNameList(dancers) }),
        schedule_date: scheduleDate,
        practice_date: practiceDate || null,
        practice_time: practiceTime || null,
        slow_songs: slowSongs || [],
        fast_songs: fastSongs || [],
        submitted_by: submittedBy || 'Unknown',
        status: 'Active',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ success: false, message: 'Error creating schedule: ' + error.message }, { status: 500 });
    }

    // Send notification to the assigned Song Leader (if created by admin for someone else)
    if (songLeaderId) {
      try {
        const dateFormatted = new Date(scheduleDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        await supabase.from('notifications').insert({
          user_id: songLeaderId,
          title: '🎵 You have been assigned as Song Leader!',
          message: `You are assigned as Song Leader on ${dateFormatted}. ${backupSingers?.length ? `Backup singers: ${backupSingers.join(', ')}.` : ''} Please prepare your songs.`,
          type: 'lineup',
          link: '/dashboard?section=create-lineup',
        });
      } catch (notifErr) {
        console.error('Failed to send notification:', notifErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Lineup created successfully!',
      data: {
        scheduleId: newSchedule.schedule_id,
        scheduleDate: newSchedule.schedule_date,
      },
    });
  } catch (error) {
    console.error('Create schedule error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}

// PUT update a schedule/lineup
export async function PUT(request) {
  try {
    const body = await request.json();
    const { scheduleId, songLeader, backupSingers, musicians, dancers, scheduleDate, practiceDate, practiceTime, slowSongs, fastSongs, songLeaderId, notifyLeader } = body;

    if (!scheduleId) {
      return NextResponse.json({ success: false, message: 'Schedule ID is required' }, { status: 400 });
    }
    const clash = doubleBooked({ songLeader, backupSingers, musicians, dancers });
    if (clash) return clash;

    // Only what was sent changes. The Monthly Planner sends the people and
    // nothing else, so the songs a Song Leader already added are kept.
    const patch = {};
    if (songLeader !== undefined) patch.song_leader = songLeader;
    if (backupSingers !== undefined) patch.backup_singers = backupSingers || [];
    if (musicians !== undefined) patch.musicians = cleanLineupMusicians(musicians);
    if (dancers !== undefined) patch.dancers = cleanNameList(dancers);
    if (scheduleDate !== undefined) patch.schedule_date = scheduleDate;
    if (practiceDate !== undefined) patch.practice_date = practiceDate || null;
    if (practiceTime !== undefined) patch.practice_time = practiceTime || null;
    if (slowSongs !== undefined) patch.slow_songs = slowSongs || [];
    if (fastSongs !== undefined) patch.fast_songs = fastSongs || [];

    const { error } = await supabase
      .from('schedules')
      .update(patch)
      .eq('schedule_id', scheduleId);

    if (error) {
      return NextResponse.json({ success: false, message: 'Error updating schedule: ' + error.message }, { status: 500 });
    }

    // Notify the song leader if reassigned
    if (notifyLeader && songLeaderId) {
      try {
        const dateFormatted = new Date(scheduleDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        await supabase.from('notifications').insert({
          user_id: songLeaderId,
          title: '🎵 Lineup Updated — You are Song Leader!',
          message: `Your lineup for ${dateFormatted} has been updated. ${backupSingers?.length ? `Backup singers: ${backupSingers.join(', ')}.` : ''} Please review your songs.`,
          type: 'lineup',
          link: '/dashboard?section=create-lineup',
        });
      } catch (notifErr) {
        console.error('Failed to send notification:', notifErr);
      }
    }

    return NextResponse.json({ success: true, message: 'Lineup updated successfully!' });
  } catch (error) {
    console.error('Update schedule error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}

// DELETE a schedule/lineup
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scheduleId = searchParams.get('scheduleId');

    if (!scheduleId) {
      return NextResponse.json({ success: false, message: 'Schedule ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('schedule_id', scheduleId);

    if (error) {
      return NextResponse.json({ success: false, message: 'Error deleting schedule: ' + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Lineup deleted successfully!' });
  } catch (error) {
    console.error('Delete schedule error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
