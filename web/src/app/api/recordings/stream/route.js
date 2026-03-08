import { NextResponse } from 'next/server';
import { streamFromGoogleDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';

// Stream a Google Drive file for in-browser playback
// Usage: /api/recordings/stream?fileId=GOOGLE_DRIVE_FILE_ID
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json({ success: false, message: 'fileId is required' }, { status: 400 });
    }

    // Forward Range header for seeking support
    const rangeHeader = request.headers.get('range') || null;

    const result = await streamFromGoogleDrive(fileId, rangeHeader);

    // Build response headers
    const responseHeaders = new Headers();
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'public, max-age=3600');

    if (result.headers['Content-Type']) {
      responseHeaders.set('Content-Type', result.headers['Content-Type']);
    }
    if (result.headers['Content-Length']) {
      responseHeaders.set('Content-Length', result.headers['Content-Length']);
    }
    if (result.headers['Content-Range']) {
      responseHeaders.set('Content-Range', result.headers['Content-Range']);
    }

    return new Response(result.body, {
      status: result.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Stream error:', error.message);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
