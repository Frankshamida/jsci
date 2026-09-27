import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventForPublicSlug, readPass } from '@/lib/eventAccess';
import { photoUrls, photosCacheKey } from '@/lib/eventPhotos';
import { cached } from '@/lib/serverCache';

// GET /api/events/public/photos?slug=...   (header x-event-pass: <pass>)
//   The event's photos, for somebody holding a pass from /unlock.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const event = await eventForPublicSlug(searchParams.get('slug'));
    if (!event) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }
    if (!readPass(request.headers.get('x-event-pass'), event.id)) {
      return NextResponse.json({ success: false, locked: true, message: 'Unlock the photos first.' }, { status: 401 });
    }

    // One database read per event every five minutes, however many phones are open
    // on the page. Uploads and deletes clear it (see /api/events/photos).
    const data = await cached(photosCacheKey(event.id), 300_000, async () => {
      const query = (fields) => supabaseAdmin
        .from('event_photos')
        .select(fields)
        .eq('event_id', event.id)
        .order('created_at', { ascending: false });
      // Before event_photo_days.sql is run there is no day_date: every photo
      // is simply on no day.
      let { data: rows, error } = await query('id, public_id, url, width, height, caption, day_date, created_at');
      if (error && /day_date/i.test(error.message || '')) ({ data: rows, error } = await query('id, public_id, url, width, height, caption, created_at'));
      if (error) throw error;
      return (rows || []).map((p) => ({
        id: p.id, width: p.width, height: p.height, caption: p.caption, day: p.day_date || null, ...photoUrls(p),
      }));
    });

    return NextResponse.json({ success: true, data }, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
