import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary, deleteFromCloudinary, isCloudinaryUrl } from '@/lib/cloudinary';

export const dynamic = 'force-dynamic';

// Safe error message extraction
function safeMsg(e) {
  try {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message || 'Unknown error';
    return JSON.stringify(e).substring(0, 300);
  } catch { return 'Unknown error'; }
}

// Guaranteed JSON response – never crashes
function safeJSON(data, status = 200) {
  try {
    return NextResponse.json(data, { status });
  } catch {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

// ==================== GET ====================
export async function GET(request) {
  try {
    let id, category, search, status, limit, offset;

    // Parse query params safely
    try {
      const { searchParams } = new URL(request.url);
      id = searchParams.get('id');
      category = searchParams.get('category');
      search = searchParams.get('search');
      status = searchParams.get('status');
      limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50') || 50, 1), 200);
      offset = Math.max(parseInt(searchParams.get('offset') || '0') || 0, 0);
    } catch {
      return safeJSON({ success: false, message: 'Invalid request URL' }, 400);
    }

    // Single recording by ID
    if (id) {
      try {
        const { data, error } = await supabase.from('recordings').select('*').eq('id', id).single();
        if (error) {
          console.error('[recordings GET] single fetch error:', error.message);
          return safeJSON({ success: false, message: 'Recording not found' }, 404);
        }
        return safeJSON({ success: true, data });
      } catch (e) {
        console.error('[recordings GET] single fetch crash:', safeMsg(e));
        return safeJSON({ success: false, message: 'Failed to fetch recording' }, 500);
      }
    }

    // List recordings
    try {
      let query = supabase.from('recordings').select('*', { count: 'exact' });

      if (category && category !== 'All') query = query.eq('category', category);
      if (status) query = query.eq('status', status);
      else query = query.neq('status', 'Archived');

      if (search && typeof search === 'string' && search.trim().length > 0) {
        // Sanitize search input – escape % and _ to prevent injection
        const sanitized = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
        query = query.or(`title.ilike.%${sanitized}%,description.ilike.%${sanitized}%,uploaded_by_name.ilike.%${sanitized}%`);
      }

      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) {
        console.error('[recordings GET] list error:', error.message);
        return safeJSON({ success: false, message: 'Failed to fetch recordings' }, 500);
      }

      return safeJSON({ success: true, data: data || [], count: count || 0 });
    } catch (e) {
      console.error('[recordings GET] list crash:', safeMsg(e));
      return safeJSON({ success: false, message: 'Failed to fetch recordings' }, 500);
    }
  } catch (outerError) {
    console.error('[recordings GET] CRITICAL:', safeMsg(outerError));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// ==================== POST ====================
export async function POST(request) {
  try {
    let contentType = '';
    try { contentType = request.headers.get('content-type') || ''; } catch { contentType = ''; }

    if (contentType.includes('multipart/form-data')) {
      // --- File upload flow ---
      let formData;
      try {
        formData = await request.formData();
      } catch (e) {
        console.error('[recordings POST] formData parse error:', safeMsg(e));
        return safeJSON({ success: false, message: 'Failed to parse form data' }, 400);
      }

      const file = formData.get('file');
      const title = formData.get('title');

      if (!file || !title) {
        return safeJSON({ success: false, message: 'File and title are required' }, 400);
      }

      // Parse file safely
      let arrayBuffer, fileName, mimeType;
      try {
        arrayBuffer = await file.arrayBuffer();
        fileName = `${Date.now()}_${(file.name || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        mimeType = file.type || 'application/octet-stream';
      } catch (e) {
        console.error('[recordings POST] file read error:', safeMsg(e));
        return safeJSON({ success: false, message: 'Failed to read uploaded file' }, 400);
      }

      // Upload to Cloudinary
      let cloudinaryResult;
      try {
        cloudinaryResult = await uploadBufferToCloudinary(arrayBuffer, {
          fileName,
          mimeType,
          folder: 'JSCI-System/recordings',
          resourceType: 'auto',
        });
      } catch (e) {
        console.error('[recordings POST] Cloudinary upload error:', safeMsg(e));
        return safeJSON({ success: false, message: `Cloudinary upload failed: ${safeMsg(e)}` }, 502);
      }

      // Save metadata to Supabase
      try {
        const description = formData.get('description') || '';
        const category = formData.get('category') || 'Worship';
        const recordingDate = formData.get('recording_date');
        const tags = formData.get('tags') || '[]';
        const uploadedBy = formData.get('uploaded_by') || null;
        const uploadedByName = formData.get('uploaded_by_name') || '';
        const isPublic = formData.get('is_public') !== 'false';
        const status = formData.get('status') || 'Published';

        let parsedTags = [];
        try { parsedTags = JSON.parse(tags); } catch { parsedTags = []; }

        const { data, error } = await supabase.from('recordings').insert({
          title: String(title).trim(),
          description: String(description).trim(),
          category,
          recording_date: recordingDate || null,
          file_name: file.name || fileName,
          file_size_bytes: file.size || 0,
          mime_type: mimeType,
          google_drive_file_id: cloudinaryResult.publicId,
          google_drive_url: cloudinaryResult.secureUrl,
          google_drive_thumbnail: cloudinaryResult.secureUrl,
          uploaded_by: uploadedBy,
          uploaded_by_name: uploadedByName,
          tags: parsedTags,
          is_public: isPublic,
          status,
        }).select().single();

        if (error) {
          // Cleanup Cloudinary file on DB failure (best-effort)
          try { await deleteFromCloudinary(cloudinaryResult.publicId, cloudinaryResult.resourceType); } catch (cleanupErr) {
            console.warn('[recordings POST] Cloudinary cleanup failed:', safeMsg(cleanupErr));
          }
          console.error('[recordings POST] Supabase insert error:', error.message);
          return safeJSON({ success: false, message: 'Failed to save recording metadata' }, 500);
        }

        return safeJSON({ success: true, data, message: 'Recording uploaded to Cloudinary!' });
      } catch (e) {
        // Cleanup Cloudinary file on crash (best-effort)
        try { await deleteFromCloudinary(cloudinaryResult.publicId, cloudinaryResult.resourceType); } catch {}
        console.error('[recordings POST] metadata save crash:', safeMsg(e));
        return safeJSON({ success: false, message: 'Failed to save recording' }, 500);
      }
    }

    // --- JSON body (link existing Drive file) ---
    let body;
    try {
      body = await request.json();
    } catch (e) {
      console.error('[recordings POST] JSON parse error:', safeMsg(e));
      return safeJSON({ success: false, message: 'Invalid JSON body' }, 400);
    }

    const { title, description, category, recording_date, google_drive_url, uploaded_by, uploaded_by_name, tags, is_public, status } = body || {};

    if (!title) {
      return safeJSON({ success: false, message: 'Title is required' }, 400);
    }

    let driveFileId = null;
    if (google_drive_url) {
      try {
        const match = String(google_drive_url).match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) driveFileId = match[1];
      } catch {}
    }

    try {
      const { data, error } = await supabase.from('recordings').insert({
        title: String(title).trim(),
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

      if (error) {
        console.error('[recordings POST] JSON insert error:', error.message);
        return safeJSON({ success: false, message: 'Failed to save recording' }, 500);
      }

      return safeJSON({ success: true, data });
    } catch (e) {
      console.error('[recordings POST] JSON insert crash:', safeMsg(e));
      return safeJSON({ success: false, message: 'Failed to save recording' }, 500);
    }
  } catch (outerError) {
    console.error('[recordings POST] CRITICAL:', safeMsg(outerError));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// ==================== PUT ====================
export async function PUT(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return safeJSON({ success: false, message: 'Invalid JSON body' }, 400);
    }

    const { id, ...updates } = body || {};

    if (!id) {
      return safeJSON({ success: false, message: 'Recording ID is required' }, 400);
    }

    // Prevent updating protected fields
    delete updates.id;
    delete updates.created_at;

    try {
      const { data, error } = await supabase.from('recordings').update(updates).eq('id', id).select().single();
      if (error) {
        console.error('[recordings PUT] update error:', error.message);
        return safeJSON({ success: false, message: 'Failed to update recording' }, 500);
      }
      return safeJSON({ success: true, data });
    } catch (e) {
      console.error('[recordings PUT] update crash:', safeMsg(e));
      return safeJSON({ success: false, message: 'Failed to update recording' }, 500);
    }
  } catch (outerError) {
    console.error('[recordings PUT] CRITICAL:', safeMsg(outerError));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// ==================== DELETE ====================
export async function DELETE(request) {
  try {
    let id;
    try {
      const { searchParams } = new URL(request.url);
      id = searchParams.get('id');
    } catch {
      return safeJSON({ success: false, message: 'Invalid request URL' }, 400);
    }

    if (!id) {
      return safeJSON({ success: false, message: 'Recording ID is required' }, 400);
    }

    // Get the record first to find the Cloudinary public ID (best-effort)
    let cloudPublicId = null;
    let cloudUrl = null;
    let mimeType = null;
    try {
      const { data: recording } = await supabase.from('recordings').select('google_drive_file_id, google_drive_url, mime_type').eq('id', id).single();
      cloudPublicId = recording?.google_drive_file_id;
      cloudUrl = recording?.google_drive_url;
      mimeType = recording?.mime_type || '';
    } catch (e) {
      console.warn('[recordings DELETE] Could not fetch recording for Cloudinary cleanup:', safeMsg(e));
    }

    // Delete from Cloudinary (best-effort – never blocks Supabase delete)
    if (cloudPublicId && isCloudinaryUrl(cloudUrl || '')) {
      try {
        const hintedType = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) ? 'video' : 'raw';
        await deleteFromCloudinary(cloudPublicId, hintedType);
      } catch (e) {
        console.warn('[recordings DELETE] Cloudinary delete warning:', safeMsg(e));
      }
    }

    // Delete from Supabase
    try {
      const { error } = await supabase.from('recordings').delete().eq('id', id);
      if (error) {
        console.error('[recordings DELETE] Supabase error:', error.message);
        return safeJSON({ success: false, message: 'Failed to delete recording' }, 500);
      }
    } catch (e) {
      console.error('[recordings DELETE] Supabase crash:', safeMsg(e));
      return safeJSON({ success: false, message: 'Failed to delete recording' }, 500);
    }

    return safeJSON({ success: true, message: 'Recording deleted' });
  } catch (outerError) {
    console.error('[recordings DELETE] CRITICAL:', safeMsg(outerError));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}
