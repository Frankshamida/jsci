import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { cacheInvalidate } from '@/lib/serverCache';
import { serviceDate } from '@/lib/serviceVideos';
import { videoEditor } from '@/lib/serviceVideosServer';
import { parseLiveEmbed, streamDate, streamTitle, sundaySlugBase } from '@/lib/sundayService';
import {
  STREAMS_TABLE, SUNDAY_MIGRATION_NOTE, allocateStreamSlug, noSundayColumns, streamRowFrom, sundayColumnsReady,
} from '@/lib/sundayServiceServer';

export const dynamic = 'force-dynamic';

// Dashboard > Social Media > Sunday Service. Admin and Super Admin only.
//
//   GET    ?actorId=                 every stream, hidden ones too, with its
//                                    hearts and comments from the Community Hub
//   POST   { actorId, stream }       a new one
//   PUT    { actorId, id, stream }   save it
//   PUT    { actorId, id, action }   'live' | 'end' | 'publish' | 'hide'
//   DELETE { actorId, id }
//
// One service is live at a time: putting one live ends the one before.
// Each stream gets a slug: its date for a plain "Sunday Service"
// (/sunday-service/2026-11-29), its title for one with its own. A new slug
// keeps the old one in old_slugs, so links to it still arrive.

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const failFrom = (error, fallback) => (noSundayColumns(error)
  ? fail(SUNDAY_MIGRATION_NOTE, 503)
  : fail(error?.message || fallback, 500));

async function audit(user, action, id, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({ user_id: user.id, action, resource: 'live_stream', resource_id: id, details });
  } catch { /* the stream is saved; the log is not worth failing over */ }
}

// The pages and the "Live" badge read cached copies; a change shows at once.
const refresh = () => {
  cacheInvalidate('live-streams:now');
  try { revalidatePath('/sunday-service', 'layout'); } catch { /* catches up by itself */ }
};

// Every other stream that is live: ended.
async function endOthers(id) {
  const { data } = await supabaseAdmin
    .from(STREAMS_TABLE)
    .update({ is_live: false, updated_at: new Date().toISOString() })
    .eq('is_live', true)
    .neq('id', id)
    .select('id');
  return (data || []).length;
}

// The same Facebook video already posted (another row than `exceptId`).
async function sameVideo(key, src, exceptId) {
  const { data } = await supabaseAdmin.from(STREAMS_TABLE).select('id, title, caption, service_date, created_at, iframe_url');
  return (data || []).find((r) => {
    if (r.id === exceptId) return false;
    if (r.iframe_url === src) return true;
    return parseLiveEmbed(r.iframe_url).key === key;
  }) || null;
}
const twinMessage = (twin) => {
  const d = serviceDate(streamDate(twin));
  return `This live is already posted, as "${streamTitle(twin)}"${d ? ` (${d.medium})` : ''}. Edit that one instead.`;
};

// A stream as the dashboard shows it.
const forDashboard = (r, counts = {}) => {
  const parsed = parseLiveEmbed(r.iframe_url);
  return {
    ...r,
    title: streamTitle(r),
    service_date: streamDate(r),
    link: parsed.link || null,
    src: parsed.src || null,
    reactionCount: counts.reactions || 0,
    commentCount: counts.comments || 0,
  };
};

async function countsFor(id) {
  const [{ count: reactions }, { count: comments }] = await Promise.all([
    supabaseAdmin.from('live_stream_reactions').select('*', { count: 'exact', head: true }).eq('stream_id', id),
    supabaseAdmin.from('live_stream_comments').select('*', { count: 'exact', head: true }).eq('stream_id', id),
  ]);
  return { reactions, comments };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const editor = await videoEditor(searchParams.get('actorId'));
  if (editor.error) return fail(editor.error, editor.status);
  const { data, error } = await supabaseAdmin.from(STREAMS_TABLE).select('*').order('created_at', { ascending: false });
  if (error) return failFrom(error, 'Could not load the services.');
  let ready = true;
  try { ready = await sundayColumnsReady(); } catch { /* the list is there; the note is not worth failing over */ }
  const rows = await Promise.all((data || []).map(async (r) => forDashboard(r, await countsFor(r.id).catch(() => ({})))));
  rows.sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)) || String(b.created_at).localeCompare(String(a.created_at)));
  return NextResponse.json(
    { success: true, data: rows, setupNote: ready ? null : SUNDAY_MIGRATION_NOTE },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const editor = await videoEditor(body.actorId);
  if (editor.error) return fail(editor.error, editor.status);
  const { row, videoKey, error: invalid } = streamRowFrom(body.stream);
  if (invalid) return fail(invalid);

  const twin = await sameVideo(videoKey, row.iframe_url);
  if (twin) return fail(twinMessage(twin), 409);

  let slug;
  try { slug = await allocateStreamSlug(row.title, row.service_date); } catch (err) { return failFrom(err, 'Could not post the service.'); }
  const { data, error } = await supabaseAdmin
    .from(STREAMS_TABLE)
    .insert({ ...row, slug, old_slugs: [], posted_by: editor.user.id, posted_by_name: editor.name })
    .select('*')
    .single();
  if (error) return failFrom(error, 'Could not post the service.');
  const ended = data.is_live ? await endOthers(data.id) : 0;
  await audit(editor.user, 'live_stream_create', data.id, { title: data.title, service_date: data.service_date, is_live: data.is_live });
  refresh();
  return NextResponse.json({ success: true, data: forDashboard(data), ended }, { status: 201 });
}

export async function PUT(request) {
  const body = await request.json().catch(() => ({}));
  const editor = await videoEditor(body.actorId);
  if (editor.error) return fail(editor.error, editor.status);
  if (!body.id) return fail('Which service?');

  const ACTIONS = {
    live: { is_live: true, is_active: true },
    end: { is_live: false },
    publish: { is_active: true },
    hide: { is_active: false, is_live: false },
  };
  let changes;
  if (body.action) {
    changes = ACTIONS[body.action];
    if (!changes) return fail('Unknown action.');
  } else {
    const { row, videoKey, error: invalid } = streamRowFrom(body.stream);
    if (invalid) return fail(invalid);
    const twin = await sameVideo(videoKey, row.iframe_url, body.id);
    if (twin) return fail(twinMessage(twin), 409);
    const { data: before, error: readError } = await supabaseAdmin
      .from(STREAMS_TABLE).select('id, title, caption, service_date, created_at, slug, old_slugs').eq('id', body.id).maybeSingle();
    if (readError) return failFrom(readError, 'Could not save the service.');
    if (!before) return fail('That service is gone. Reload the list.', 404);
    changes = { ...row, is_live: row.is_live && row.is_active };
    // A new title or date that changes the address (or none yet): a new slug,
    // the old one kept for its links.
    if (!before.slug || sundaySlugBase(row.title, row.service_date) !== sundaySlugBase(streamTitle(before), streamDate(before))) {
      let slug;
      try { slug = await allocateStreamSlug(row.title, row.service_date, body.id); } catch (err) { return failFrom(err, 'Could not save the service.'); }
      const old = new Set([...(before.old_slugs || []), before.slug].filter(Boolean));
      old.delete(slug);
      changes = { ...changes, slug, old_slugs: [...old] };
    }
  }

  const { data, error } = await supabaseAdmin
    .from(STREAMS_TABLE)
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('*')
    .maybeSingle();
  if (error) return failFrom(error, 'Could not save the service.');
  if (!data) return fail('That service is gone. Reload the list.', 404);
  const ended = data.is_live ? await endOthers(data.id) : 0;
  await audit(editor.user, body.action ? `live_stream_${body.action}` : 'live_stream_update', data.id, { title: data.title });
  refresh();
  return NextResponse.json({ success: true, data: forDashboard(data, await countsFor(data.id).catch(() => ({}))), ended });
}

export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const editor = await videoEditor(body.actorId);
  if (editor.error) return fail(editor.error, editor.status);
  if (!body.id) return fail('Which service?');
  const { data, error } = await supabaseAdmin.from(STREAMS_TABLE).delete().eq('id', body.id).select('id, title, caption').maybeSingle();
  if (error) return failFrom(error, 'Could not delete the service.');
  if (data) await audit(editor.user, 'live_stream_delete', data.id, { title: streamTitle(data) });
  refresh();
  return NextResponse.json({ success: true });
}
