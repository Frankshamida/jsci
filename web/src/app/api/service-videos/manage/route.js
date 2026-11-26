import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/cloudinary';
import { serviceDate, slugify } from '@/lib/serviceVideos';
import {
  MIDWEEK_MIGRATION_NOTE, VIDEOS_MIGRATION_NOTE, VIDEOS_TABLE, allocateSlug, forgetPublishedVideos, noMidweekColumns,
  rowFrom, videoEditor, videosTableMissing,
} from '@/lib/serviceVideosServer';

export const dynamic = 'force-dynamic';

// Dashboard > Social Media > Midweek Service. Admin and Super Admin only.
//
//   GET    ?actorId=                     every video, hidden ones too
//   POST   { actorId, video }            a new one
//   PUT    { actorId, id, video }        save it
//   PUT    { actorId, id, action }       'publish' | 'hide' changes only that
//   DELETE { actorId, id }
//
// Each video gets a slug from its title (/midweek/the-power-of-god). A new
// title gets a new slug, and the old one is kept in old_slugs so links to it
// still arrive (/midweek/<old> redirects to /midweek/<new>).

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const failFrom = (error, fallback) => (videosTableMissing(error)
  ? fail(VIDEOS_MIGRATION_NOTE, 503)
  : noMidweekColumns(error) ? fail(MIDWEEK_MIGRATION_NOTE, 503)
    : fail(error?.message || fallback, 500));

// A cover picture (from before the thumbnail templates) of a deleted video:
// gone from Cloudinary too.
const dropCover = async (publicId) => {
  if (!publicId) return;
  try { await deleteFromCloudinary(publicId, 'image'); } catch { /* left in Cloudinary; harmless */ }
};

async function audit(user, action, id, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({ user_id: user.id, action, resource: 'service_video', resource_id: id, details });
  } catch { /* the video is saved; the log is not worth failing over */ }
}

// The /midweek pages are cached; a change should show at once.
const refresh = () => {
  forgetPublishedVideos();
  try { revalidatePath('/midweek', 'layout'); } catch { /* catches up by itself */ }
};

// The same Facebook video already in the list (another row than `exceptId`):
// the same video number in its link, or the very same link.
async function sameVideo(key, url, exceptId) {
  const { data } = await supabaseAdmin.from(VIDEOS_TABLE).select('id, title, service_date, video_url');
  const numbered = /^\d{5,}$/.test(key);
  const numbersIn = (link) => String(link || '').match(/\d{5,}/g) || [];
  return (data || []).find((r) => r.id !== exceptId
    && (r.video_url === url || (numbered && numbersIn(r.video_url).includes(key)))) || null;
}
const twinMessage = (twin) => `This video is already posted, as "${twin.title}" (${serviceDate(twin.service_date)?.medium || twin.service_date}). Edit that one instead.`;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const editor = await videoEditor(searchParams.get('actorId'));
  if (editor.error) return fail(editor.error, editor.status);
  const { data, error } = await supabaseAdmin
    .from(VIDEOS_TABLE)
    .select('*')
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return failFrom(error, 'Could not load the videos.');
  return NextResponse.json({ success: true, data: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const editor = await videoEditor(body.actorId);
  if (editor.error) return fail(editor.error, editor.status);
  const { row, videoKey, error: invalid } = rowFrom(body.video);
  if (invalid) return fail(invalid);

  const twin = await sameVideo(videoKey, row.video_url);
  if (twin) return fail(twinMessage(twin), 409);

  let slug;
  try { slug = await allocateSlug(row.title, row.service_date); } catch (err) { return failFrom(err, 'Could not post the video.'); }
  const { data, error } = await supabaseAdmin
    .from(VIDEOS_TABLE)
    .insert({ ...row, slug, old_slugs: [], posted_by: editor.user.id, posted_by_name: editor.name })
    .select('*')
    .single();
  if (error) return failFrom(error, 'Could not post the video.');
  await audit(editor.user, 'service_video_create', data.id, { title: data.title, service_date: data.service_date });
  refresh();
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export async function PUT(request) {
  const body = await request.json().catch(() => ({}));
  const editor = await videoEditor(body.actorId);
  if (editor.error) return fail(editor.error, editor.status);
  if (!body.id) return fail('Which video?');

  let changes;
  if (body.action === 'publish' || body.action === 'hide') {
    changes = { is_published: body.action === 'publish' };
  } else {
    const { row, videoKey, error: invalid } = rowFrom(body.video);
    if (invalid) return fail(invalid);
    const twin = await sameVideo(videoKey, row.video_url, body.id);
    if (twin) return fail(twinMessage(twin), 409);
    const { data: before, error: readError } = await supabaseAdmin
      .from(VIDEOS_TABLE).select('id, title, slug, old_slugs').eq('id', body.id).maybeSingle();
    if (readError) return failFrom(readError, 'Could not save the video.');
    if (!before) return fail('That video is gone. Reload the list.', 404);
    changes = row;
    // A new title (or none yet): a new slug, the old one kept for its links.
    if (!before.slug || slugify(row.title) !== slugify(before.title)) {
      let slug;
      try { slug = await allocateSlug(row.title, row.service_date, body.id); } catch (err) { return failFrom(err, 'Could not save the video.'); }
      const old = new Set([...(before.old_slugs || []), before.slug].filter(Boolean));
      old.delete(slug);
      changes = { ...row, slug, old_slugs: [...old] };
    }
  }

  const { data, error } = await supabaseAdmin
    .from(VIDEOS_TABLE)
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('*')
    .maybeSingle();
  if (error) return failFrom(error, 'Could not save the video.');
  if (!data) return fail('That video is gone. Reload the list.', 404);
  await audit(editor.user, body.action ? `service_video_${body.action}` : 'service_video_update', data.id, { title: data.title });
  refresh();
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const editor = await videoEditor(body.actorId);
  if (editor.error) return fail(editor.error, editor.status);
  if (!body.id) return fail('Which video?');
  const { data, error } = await supabaseAdmin.from(VIDEOS_TABLE).delete().eq('id', body.id).select('*').maybeSingle();
  if (error) return failFrom(error, 'Could not delete the video.');
  if (data) {
    await dropCover(data.cover_public_id);
    await audit(editor.user, 'service_video_delete', data.id, { title: data.title });
  }
  refresh();
  return NextResponse.json({ success: true });
}
