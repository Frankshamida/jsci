import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { clientIp, cleanVisitor, eventForPublicSlug } from '@/lib/eventAccess';
import { rateLimit } from '@/lib/serverCache';

const MIGRATION_HINT = 'Hearts need their migration: run supabase/migrations/event_feedback_and_photo_hearts.sql.';
const missingTable = (error) => /event_photo_heart/i.test(error?.message || '');

// POST /api/events/public/photos/hearts  { slug, photoId, visitor, on }
//   A heart on one photo from the public event page - or taken back. No
//   login: visitor is the random id the page keeps in the browser, so the
//   same phone tapping twice is one heart, not two. Answers with the photo's
//   new count, so every phone that taps sees the real number.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const visitor = cleanVisitor(body.visitor);
    const photoId = String(body.photoId || '').trim();
    if (!visitor || !/^[0-9a-f-]{36}$/i.test(photoId)) {
      return NextResponse.json({ success: false, message: 'That photo could not be hearted.' }, { status: 400 });
    }
    // Generous - a person scrolling a gallery and tapping hearts is fast - but
    // a script tapping thousands is held back.
    if (!rateLimit(`photo-hearts:${clientIp(request)}`, 240, 10 * 60_000).allowed) {
      return NextResponse.json({ success: false, message: 'Too many hearts at once. Try again in a few minutes.' }, { status: 429 });
    }

    const event = await eventForPublicSlug(body.slug);
    if (!event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    // Only a photo of THIS event: the id comes from the browser.
    const { data: photo } = await supabaseAdmin
      .from('event_photos').select('id').eq('id', photoId).eq('event_id', event.id).maybeSingle();
    if (!photo) return NextResponse.json({ success: false, message: 'Photo not found' }, { status: 404 });

    const on = body.on !== false;
    const { error } = on
      ? await supabaseAdmin.from('event_photo_hearts').upsert(
        { photo_id: photoId, event_id: event.id, visitor_id: visitor },
        { onConflict: 'photo_id,visitor_id', ignoreDuplicates: true },
      )
      : await supabaseAdmin.from('event_photo_hearts').delete().eq('photo_id', photoId).eq('visitor_id', visitor);
    if (error) {
      return NextResponse.json({ success: false, message: missingTable(error) ? MIGRATION_HINT : error.message }, { status: 500 });
    }

    const { count } = await supabaseAdmin
      .from('event_photo_hearts').select('photo_id', { count: 'exact', head: true }).eq('photo_id', photoId);
    return NextResponse.json({ success: true, hearted: on, hearts: count || 0 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
