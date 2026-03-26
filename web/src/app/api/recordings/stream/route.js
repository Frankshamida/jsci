import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { streamFromGoogleDrive } from '@/lib/googleDrive';
import { isCloudinaryUrl, buildCloudinaryAudioUrl, buildCloudinaryImageUrl, cloudinaryDefaults } from '@/lib/cloudinary';

export const dynamic = 'force-dynamic';

// Safely extract error message from anything
function safeErrorMessage(error) {
  try {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || 'Unknown error';
    if (typeof error === 'object') return JSON.stringify(error).substring(0, 200);
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

// Map error messages → HTTP status codes
function errorToStatus(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('not found') || m.includes('404') || m.includes('deleted')) return 404;
  if (m.includes('access denied') || m.includes('forbidden') || m.includes('403')) return 403;
  if (m.includes('refresh token') || m.includes('access token') || m.includes('invalid_grant') || m.includes('not configured') || m.includes('token')) return 503;
  if (m.includes('timeout') || m.includes('timed out') || m.includes('aborted')) return 504;
  return 500;
}

async function resolveCloudinaryAsset(fileId) {
  const lookups = [
    () => supabase.from('recordings').select('google_drive_url, google_drive_file_id, mime_type').eq('google_drive_file_id', fileId).limit(1).maybeSingle(),
    () => supabase.from('practice_recordings').select('google_drive_url, google_drive_file_id, mime_type').eq('google_drive_file_id', fileId).limit(1).maybeSingle(),
    () => supabase.from('community_post_images').select('google_drive_file_id, mime_type').eq('google_drive_file_id', fileId).limit(1).maybeSingle(),
  ];

  for (const query of lookups) {
    try {
      const { data } = await query();
      if (!data) continue;
      const mimeType = data.mime_type || '';
      const url = data.google_drive_url || '';
      const publicId = data.google_drive_file_id || fileId;
      return { url, mimeType, publicId };
    } catch {
      // Try next source.
    }
  }

  return null;
}

// Stream a Google Drive file for in-browser playback
// Usage: /api/recordings/stream?fileId=GOOGLE_DRIVE_FILE_ID
export async function GET(request) {
  // Outer try-catch: absolutely nothing escapes
  try {
    // --- Validate input ---
    let fileId = null;
    try {
      const { searchParams } = new URL(request.url);
      fileId = searchParams.get('fileId');
    } catch {
      return NextResponse.json({ success: false, message: 'Invalid request URL' }, { status: 400 });
    }

    if (!fileId || typeof fileId !== 'string' || fileId.trim().length === 0) {
      return NextResponse.json({ success: false, message: 'fileId query parameter is required' }, { status: 400 });
    }

    // --- Forward Range header for seeking ---
    let rangeHeader = null;
    try {
      rangeHeader = request.headers.get('range') || null;
    } catch {
      // ignore – proceed without range
    }

    // --- Cloudinary path for newly uploaded assets ---
    const asset = await resolveCloudinaryAsset(fileId);
    if (asset) {
      const { mimeType = '', publicId } = asset;
      const profile = (() => {
        try {
          const { searchParams } = new URL(request.url);
          return searchParams.get('profile') || 'balanced';
        } catch { return 'balanced'; }
      })();

      const isImage = mimeType.startsWith('image/');
      const isAudioOrVideo = mimeType.startsWith('audio/') || mimeType.startsWith('video/');

      const audioTransform = profile === 'audio-lite'
        ? { ...cloudinaryDefaults.audio, bitrate: '64k', quality: 'auto:eco' }
        : cloudinaryDefaults.audio;

      const transformedUrl = isAudioOrVideo
        ? buildCloudinaryAudioUrl(publicId, audioTransform)
        : isImage
          ? buildCloudinaryImageUrl(publicId, { ...cloudinaryDefaults.image, width: 1600 })
          : null;

      const deliveryUrl = transformedUrl || (isCloudinaryUrl(asset.url) ? asset.url : null);

      if (deliveryUrl) {
        try {
          const upstream = await fetch(deliveryUrl, {
            headers: rangeHeader ? { Range: rangeHeader } : {},
          });

          if (upstream.ok || upstream.status === 206) {
            const responseHeaders = new Headers();
            responseHeaders.set('Accept-Ranges', 'bytes');
            responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=259200, stale-while-revalidate=604800');
            responseHeaders.set('X-Content-Type-Options', 'nosniff');
            if (upstream.headers.get('content-type')) responseHeaders.set('Content-Type', upstream.headers.get('content-type'));
            if (upstream.headers.get('content-length')) responseHeaders.set('Content-Length', upstream.headers.get('content-length'));
            if (upstream.headers.get('content-range')) responseHeaders.set('Content-Range', upstream.headers.get('content-range'));

            return new Response(upstream.body, {
              status: upstream.status || 200,
              headers: responseHeaders,
            });
          }
        } catch (e) {
          console.warn('[stream] Cloudinary fetch failed, falling back to Drive:', safeErrorMessage(e));
        }
      }
    }

    // Basic fileId sanity check for legacy Google Drive IDs (alphanumeric + _ + -)
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId)) {
      return NextResponse.json({ success: false, message: 'Invalid fileId format' }, { status: 400 });
    }

    // --- Stream from Google Drive with timeout ---
    let result;
    try {
      const streamPromise = streamFromGoogleDrive(fileId, rangeHeader);

      // 30-second timeout so a hung Google request doesn't freeze the endpoint
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Google Drive request timed out after 30 seconds')), 30000)
      );

      result = await Promise.race([streamPromise, timeoutPromise]);
    } catch (streamError) {
      const message = safeErrorMessage(streamError);
      const status = errorToStatus(message);
      console.error(`[stream] Google Drive error for fileId=${fileId}:`, message);
      return NextResponse.json({ success: false, message }, { status });
    }

    // --- Validate result shape ---
    if (!result || typeof result !== 'object') {
      console.error(`[stream] Unexpected result shape for fileId=${fileId}:`, typeof result);
      return NextResponse.json({ success: false, message: 'Unexpected response from Google Drive' }, { status: 502 });
    }

    // --- Build response headers safely ---
    const responseHeaders = new Headers();
    try {
      responseHeaders.set('Accept-Ranges', 'bytes');
      responseHeaders.set('Cache-Control', 'public, max-age=3600');
      responseHeaders.set('X-Content-Type-Options', 'nosniff');

      if (result.headers) {
        if (result.headers['Content-Type']) responseHeaders.set('Content-Type', result.headers['Content-Type']);
        if (result.headers['Content-Length']) responseHeaders.set('Content-Length', result.headers['Content-Length']);
        if (result.headers['Content-Range']) responseHeaders.set('Content-Range', result.headers['Content-Range']);
      }
    } catch (headerError) {
      console.warn('[stream] Header build warning:', safeErrorMessage(headerError));
    }

    return new Response(result.body, {
      status: result.status || 200,
      headers: responseHeaders,
    });
  } catch (outerError) {
    // This is the absolute last resort – NOTHING should reach here, but just in case:
    console.error('[stream] CRITICAL unhandled error:', safeErrorMessage(outerError));
    try {
      return NextResponse.json(
        { success: false, message: 'Internal server error' },
        { status: 500 }
      );
    } catch {
      // If even NextResponse.json fails, return bare Response
      return new Response(JSON.stringify({ success: false, message: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
