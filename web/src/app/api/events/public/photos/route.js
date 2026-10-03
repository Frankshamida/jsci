import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cleanVisitor, eventForPublicSlug } from '@/lib/eventAccess';
import { photoUrls, photosCacheKey } from '@/lib/eventPhotos';
import { cached } from '@/lib/serverCache';

// GET /api/events/public/photos?slug=...&v=<visitor id>
//   The event's photos, open to anyone with the page's link - the password
//   that used to stand in front of them is gone; the attendee's sign-in now
//   only opens their Profile and Extras.
//
//   Each photo carries its hearts: how many, and whether this browser (v, the
//   id the page keeps in local storage) gave one. heartsReady is false until
//   event_feedback_and_photo_hearts.sql has been run, and the page then shows
//   no hearts rather than hearts that cannot be pressed.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const event = await eventForPublicSlug(searchParams.get('slug'));
    if (!event) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }

    // One database read per event every five minutes, however many phones are open
    // on the page. Uploads and deletes clear it (see /api/events/photos).
    const photos = await cached(photosCacheKey(event.id), 300_000, async () => {
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

    // Hearts are not cached: somebody who just tapped one expects to see it.
    // The counts come already added up (the event_photo_heart_counts view,
    // one row per hearted photo), and this browser's own hearts separately.
    const visitor = cleanVisitor(searchParams.get('v'));
    const none = { data: [], error: null };
    const [countRes, mineRes] = photos.length
      ? await Promise.all([
        supabaseAdmin.from('event_photo_heart_counts').select('photo_id, hearts').eq('event_id', event.id),
        visitor
          ? supabaseAdmin.from('event_photo_hearts').select('photo_id').eq('event_id', event.id).eq('visitor_id', visitor)
          : none,
      ])
      : [none, none];
    const counts = new Map((countRes.data || []).map((c) => [c.photo_id, Number(c.hearts) || 0]));
    const mine = new Set((mineRes.data || []).map((h) => h.photo_id));
    const heartsErr = countRes.error;
    const data = photos.map((p) => ({ ...p, hearts: counts.get(p.id) || 0, hearted: mine.has(p.id) }));

    return NextResponse.json({ success: true, data, heartsReady: !heartsErr }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
