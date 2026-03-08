import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';

// ==================== GET ====================
// Fetch practice recordings, optionally filtered by schedule_id or schedule_date
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const scheduleId = searchParams.get('schedule_id');
    const scheduleDate = searchParams.get('schedule_date');
    const songType = searchParams.get('song_type');
    const type = searchParams.get('type'); // 'listing' = grouped by schedule

    // Single recording
    if (id) {
      const { data, error } = await supabase.from('practice_recordings').select('*').eq('id', id).single();
      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }

    // Listing mode: get all recordings grouped with schedule info
    if (type === 'listing') {
      const { data: recordings, error } = await supabase
        .from('practice_recordings')
        .select('*')
        .order('schedule_date', { ascending: false });
      if (error) throw error;

      // Get associated schedules
      const scheduleIds = [...new Set((recordings || []).map(r => r.schedule_id))];
      let schedules = [];
      if (scheduleIds.length > 0) {
        const { data: schedData } = await supabase
          .from('schedules')
          .select('schedule_id, song_leader, backup_singers, schedule_date, practice_date, slow_songs, fast_songs, status')
          .in('schedule_id', scheduleIds);
        schedules = schedData || [];
      }

      // Group recordings by schedule
      const scheduleMap = {};
      schedules.forEach(s => { scheduleMap[s.schedule_id] = s; });

      const grouped = {};
      (recordings || []).forEach(rec => {
        if (!grouped[rec.schedule_id]) {
          const sched = scheduleMap[rec.schedule_id] || {};
          grouped[rec.schedule_id] = {
            schedule_id: rec.schedule_id,
            schedule_date: rec.schedule_date,
            song_leader: sched.song_leader || 'Unknown',
            backup_singers: sched.backup_singers || [],
            slow_songs: sched.slow_songs || [],
            fast_songs: sched.fast_songs || [],
            practice_date: sched.practice_date || null,
            recordings: [],
          };
        }
        grouped[rec.schedule_id].recordings.push(rec);
      });

      return NextResponse.json({ success: true, data: Object.values(grouped) });
    }

    // Filtered list
    let query = supabase.from('practice_recordings').select('*');
    if (scheduleId) query = query.eq('schedule_id', scheduleId);
    if (scheduleDate) query = query.eq('schedule_date', scheduleDate);
    if (songType) query = query.eq('song_type', songType);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/practice-recordings error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==================== POST ====================
// Upload a practice recording (audio file) to Google Drive
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ success: false, message: 'Multipart form data required' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const scheduleId = formData.get('schedule_id');
    const scheduleDate = formData.get('schedule_date');
    const songType = formData.get('song_type');
    const title = formData.get('title');
    const description = formData.get('description') || '';
    const recordedBy = formData.get('recorded_by') || null;
    const recordedByName = formData.get('recorded_by_name') || '';

    if (!file || !scheduleId || !scheduleDate || !songType || !title) {
      return NextResponse.json({ success: false, message: 'File, schedule_id, schedule_date, song_type, and title are required' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileName = `Practice_${songType.replace(/\s/g, '')}_${scheduleDate}_${Date.now()}.${file.name.split('.').pop() || 'webm'}`;
    const mimeType = file.type || 'audio/webm';

    // Upload to Google Drive
    const driveResult = await uploadToGoogleDrive(arrayBuffer, fileName, mimeType);

    // Save metadata to Supabase
    const { data, error } = await supabase.from('practice_recordings').insert({
      schedule_id: scheduleId,
      schedule_date: scheduleDate,
      song_type: songType,
      title: title.trim(),
      description: description.trim(),
      google_drive_file_id: driveResult.id,
      google_drive_url: driveResult.webViewLink,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: mimeType,
      recorded_by: recordedBy,
      recorded_by_name: recordedByName,
    }).select().single();

    if (error) {
      try { await deleteFromGoogleDrive(driveResult.id); } catch (e) {}
      throw error;
    }

    return NextResponse.json({ success: true, data, message: 'Practice recording saved!' });
  } catch (error) {
    console.error('POST /api/practice-recordings error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==================== PUT ====================
// Update metadata or allowed_recorders
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Recording ID is required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('practice_recordings').update(updates).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PUT /api/practice-recordings error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==================== DELETE ====================
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Recording ID is required' }, { status: 400 });
    }

    // Get recording to find Drive file
    let driveFileId = null;
    try {
      const { data: rec } = await supabase.from('practice_recordings').select('google_drive_file_id').eq('id', id).single();
      driveFileId = rec?.google_drive_file_id;
    } catch (e) {}

    // Delete from Google Drive
    if (driveFileId) {
      try { await deleteFromGoogleDrive(driveFileId); } catch (e) { console.warn('Drive delete warning:', e.message); }
    }

    // Delete from Supabase
    const { error } = await supabase.from('practice_recordings').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Practice recording deleted' });
  } catch (error) {
    console.error('DELETE /api/practice-recordings error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
