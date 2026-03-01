import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
      scheduleDate: s.schedule_date,
      practiceDate: s.practice_date,
      slowSongs: s.slow_songs || [],
      fastSongs: s.fast_songs || [],
      submittedBy: s.submitted_by,
      status: s.status,
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
    const { songLeader, backupSingers, scheduleDate, practiceDate, slowSongs, fastSongs, submittedBy } = body;

    if (!songLeader || !scheduleDate) {
      return NextResponse.json({ success: false, message: 'Song leader and schedule date are required' }, { status: 400 });
    }

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
        schedule_date: scheduleDate,
        practice_date: practiceDate || null,
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
    const { scheduleId, songLeader, backupSingers, scheduleDate, practiceDate, slowSongs, fastSongs } = body;

    if (!scheduleId) {
      return NextResponse.json({ success: false, message: 'Schedule ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('schedules')
      .update({
        song_leader: songLeader,
        backup_singers: backupSingers || [],
        schedule_date: scheduleDate,
        practice_date: practiceDate || null,
        slow_songs: slowSongs || [],
        fast_songs: fastSongs || [],
      })
      .eq('schedule_id', scheduleId);

    if (error) {
      return NextResponse.json({ success: false, message: 'Error updating schedule: ' + error.message }, { status: 500 });
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
