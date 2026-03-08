import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';

// ==================== GET ====================
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (id) {
      const { data, error } = await supabase.from('recordings').select('*').eq('id', id).single();
      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }

    let query = supabase.from('recordings').select('*', { count: 'exact' });

    if (category && category !== 'All') query = query.eq('category', category);
    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'Archived');

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,uploaded_by_name.ilike.%${search}%`);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data, count });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==================== POST ====================
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const title = formData.get('title');
      const description = formData.get('description') || '';
      const category = formData.get('category') || 'Worship';
      const recordingDate = formData.get('recording_date');
      const tags = formData.get('tags') || '[]';
      const uploadedBy = formData.get('uploaded_by') || null;
      const uploadedByName = formData.get('uploaded_by_name') || '';
      const isPublic = formData.get('is_public') !== 'false';
      const status = formData.get('status') || 'Published';

      if (!file || !title) {
        return NextResponse.json({ success: false, message: 'File and title are required' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const mimeType = file.type || 'application/octet-stream';

      // Upload to Google Drive
      const driveResult = await uploadToGoogleDrive(arrayBuffer, fileName, mimeType);

      // Save metadata to Supabase
      const { data, error } = await supabase.from('recordings').insert({
        title: title.trim(),
        description: description.trim(),
        category,
        recording_date: recordingDate || null,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: mimeType,
        google_drive_file_id: driveResult.id,
        google_drive_url: driveResult.webViewLink,
        google_drive_thumbnail: driveResult.thumbnailLink || null,
        uploaded_by: uploadedBy,
        uploaded_by_name: uploadedByName,
        tags: JSON.parse(tags),
        is_public: isPublic,
        status,
      }).select().single();

      if (error) {
        try { await deleteFromGoogleDrive(driveResult.id); } catch (e) {}
        throw error;
      }

      return NextResponse.json({ success: true, data, message: 'Recording uploaded to Google Drive!' });
    }

    // JSON body (link existing Drive file)
    const body = await request.json();
    const { title, description, category, recording_date, google_drive_url, uploaded_by, uploaded_by_name, tags, is_public, status } = body;

    if (!title) {
      return NextResponse.json({ success: false, message: 'Title is required' }, { status: 400 });
    }

    let driveFileId = null;
    if (google_drive_url) {
      const match = google_drive_url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) driveFileId = match[1];
    }

    const { data, error } = await supabase.from('recordings').insert({
      title: title.trim(),
      description: (description || '').trim(),
      category: category || 'Worship',
      recording_date: recording_date || null,
      google_drive_file_id: driveFileId,
      google_drive_url: google_drive_url || null,
      uploaded_by: uploaded_by || null,
      uploaded_by_name: uploaded_by_name || '',
      tags: tags || [],
      is_public: is_public !== false,
      status: status || 'Published',
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==================== PUT ====================
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'Recording ID is required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('recordings').update(updates).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
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

    // Get the record first to find the Drive file ID
    let driveFileId = null;
    try {
      const { data: recording } = await supabase.from('recordings').select('google_drive_file_id').eq('id', id).single();
      driveFileId = recording?.google_drive_file_id;
    } catch (e) {
      console.warn('Could not fetch recording for Drive cleanup:', e.message);
    }

    // Delete from Google Drive (best-effort, don't block Supabase delete)
    if (driveFileId) {
      try { await deleteFromGoogleDrive(driveFileId); } catch (e) { console.warn('Drive delete warning:', e.message); }
    }

    // Delete from Supabase
    const { error } = await supabase.from('recordings').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Recording deleted' });
  } catch (error) {
    console.error('DELETE /api/recordings error:', error);
    return NextResponse.json({ success: false, message: error?.message || 'Delete failed' }, { status: 500 });
  }
}
