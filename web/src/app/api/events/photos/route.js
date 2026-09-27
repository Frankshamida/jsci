import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/cloudinary';
import { photoFolder, photoUrls, photosCacheKey, signPhotoUpload } from '@/lib/eventPhotos';
import { cacheInvalidate } from '@/lib/serverCache';

// Managing an event's photos from the dashboard. Attendees see them through
// /api/events/public/photos once they unlock the page.
//
// Upload is two steps, because the files never pass through this server:
//   POST { action: 'sign', eventId, actorId }         -> Cloudinary upload signature
//   (browser uploads each file to Cloudinary with it)
//   POST { action: 'save', eventId, actorId, photos, dayDate } -> the uploaded photos recorded, on that day
// PUT  { ids, dayDate, actorId }                     -> photos moved to another day (dayDate null = no day)

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

const explain = (error) => {
  const msg = error?.message || '';
  if (/day_date/i.test(msg)) return 'Photos by day need their migration: run supabase/migrations/event_photo_days.sql in the Supabase SQL editor, then try again.';
  if (/event_photos/i.test(msg)) return 'Event photos need their migration: run supabase/migrations/event_public_page.sql in the Supabase SQL editor, then try again.';
  return msg || 'Something went wrong';
};

// 'YYYY-MM-DD' or null - anything else is treated as "no day".
const dayOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

const denied = () => NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

const FIELDS = 'id, event_id, public_id, url, width, height, bytes, caption, day_date, created_at';

// GET /api/events/photos?eventId=..
export async function GET(request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const query = (fields) => supabaseAdmin
      .from('event_photos')
      .select(fields)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    let { data, error } = await query(FIELDS);
    // day_date not there yet (event_photo_days.sql not run): list them anyway, on no day.
    let needsDays = false;
    if (error && /day_date/i.test(error.message || '')) {
      needsDays = true;
      ({ data, error } = await query(FIELDS.replace(', day_date', '')));
    }
    if (error) throw error;
    return NextResponse.json({ success: true, needsDays, data: (data || []).map((p) => ({ ...p, ...photoUrls(p) })) });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return denied();
    if (!body.eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });

    if (body.action === 'sign') {
      return NextResponse.json({ success: true, data: signPhotoUpload(body.eventId) });
    }

    if (body.action === 'save') {
      // Only files that landed in this event's own folder are accepted, so the
      // table cannot be pointed at somebody else's Cloudinary assets.
      const folder = `${photoFolder(body.eventId)}/`;
      const rows = (Array.isArray(body.photos) ? body.photos : [])
        .filter((p) => typeof p?.public_id === 'string' && p.public_id.startsWith(folder)
          && typeof p?.secure_url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(p.secure_url))
        .slice(0, 200)
        .map((p) => ({
          event_id: body.eventId,
          public_id: p.public_id,
          url: p.secure_url,
          width: Number(p.width) || null,
          height: Number(p.height) || null,
          bytes: Number(p.bytes) || null,
          uploaded_by: actor.id,
          ...(dayOrNull(body.dayDate) ? { day_date: dayOrNull(body.dayDate) } : {}),
        }));
      if (!rows.length) return NextResponse.json({ success: false, message: 'No photos to save.' }, { status: 400 });

      const { data, error } = await supabaseAdmin.from('event_photos').insert(rows).select(FIELDS);
      if (error) throw error;
      cacheInvalidate(photosCacheKey(body.eventId));
      return NextResponse.json({ success: true, data: (data || []).map((p) => ({ ...p, ...photoUrls(p) })) });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// PUT { ids, dayDate, actorId } - put photos on another day.
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return denied();
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).filter((x) => typeof x === 'string' && x).slice(0, 500);
    if (!ids.length) return NextResponse.json({ success: false, message: 'ids required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('event_photos').update({ day_date: dayOrNull(body.dayDate) }).in('id', ids).select(FIELDS);
    if (error) throw error;
    [...new Set((data || []).map((p) => p.event_id))].forEach((eid) => cacheInvalidate(photosCacheKey(eid)));
    return NextResponse.json({ success: true, data: (data || []).map((p) => ({ ...p, ...photoUrls(p) })) });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// DELETE /api/events/photos?id=..&actorId=..
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) return denied();
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { data: photo, error: findErr } = await supabaseAdmin
      .from('event_photos').select('id, event_id, public_id').eq('id', id).maybeSingle();
    if (findErr) throw findErr;
    if (!photo) return NextResponse.json({ success: true });

    // The file first: a row with no file is a broken tile, a file with no row
    // is storage nobody can see or clear.
    try { await deleteFromCloudinary(photo.public_id, 'image'); } catch { /* already gone */ }
    const { error } = await supabaseAdmin.from('event_photos').delete().eq('id', id);
    if (error) throw error;
    cacheInvalidate(photosCacheKey(photo.event_id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}
