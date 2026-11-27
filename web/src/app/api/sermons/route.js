import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { getUserRoles } from '@/lib/permissions';
import { getCloudinaryConfig, deleteFromCloudinary } from '@/lib/cloudinary';
import {
  SERMON_MAX_BYTES, SERMON_FOLDER, SERMONS_MIGRATION_NOTE, SERMON_READERS, SERMON_EDITORS, LIMITS, sermonFormat,
} from '@/lib/sermons';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// /api/sermons - Dashboard > Sermons (components/sermons/SermonsSection)
//   GET    ?actorId=..                    the sermons, newest first
//   POST   { action: 'sign', actorId, fileName, bytes }
//            -> a Cloudinary upload signature: the browser sends the file
//               straight to Cloudinary (it never passes through this server,
//               whose requests stop at 4.5 MB on Vercel)
//   POST   { action: 'create', actorId, title, preachedOn, preacher, passage,
//            summary, file: { publicId, url, bytes, name } }
//   PATCH  { actorId, id, title, preachedOn, preacher, passage, summary }
//   DELETE ?actorId=..&id=..               the sermon and its file
// Members read; Pastors upload, edit and delete (a Super Admin always may).
// ============================================================

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const tableMissing = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205'
  || (/sermons/.test(String(error.message || '')) && /does not exist|schema cache|not find/i.test(String(error.message || ''))));

const line = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const para = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\r\n?/g, '\n')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

const SELECT = 'id, title, preached_on, preacher, passage, summary, file_url, file_public_id, file_name, file_format, file_bytes, uploaded_by_name, created_at';
const shape = (s) => ({
  id: s.id, title: s.title, preachedOn: s.preached_on, preacher: s.preacher || '', passage: s.passage || '',
  summary: s.summary || '', url: s.file_url, fileName: s.file_name || '', format: s.file_format,
  bytes: s.file_bytes || 0, uploadedBy: s.uploaded_by_name || '', createdAt: s.created_at,
});

// The words a sermon is saved with, checked. { fields } or { error }.
function details(body) {
  const title = line(body.title, LIMITS.title);
  if (!title) return { error: 'Give the sermon a title.' };
  const preachedOn = String(body.preachedOn || '');
  if (!DATE.test(preachedOn) || Number.isNaN(Date.parse(preachedOn))) return { error: 'Pick the day it was preached.' };
  return {
    fields: {
      title,
      preached_on: preachedOn,
      preacher: line(body.preacher, LIMITS.preacher) || null,
      passage: line(body.passage, LIMITS.passage) || null,
      summary: para(body.summary, LIMITS.summary) || null,
    },
  };
}

async function audit(who, action, id, info) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: who.user.id, user_name: who.name, action, resource: 'sermons', resource_id: id ? String(id) : null, details: info || null,
    });
  } catch { /* non-fatal */ }
}

export async function GET(request) {
  const who = await requireRole(new URL(request.url).searchParams.get('actorId'), SERMON_READERS);
  if (who.error) return bad(who.error, who.status);
  try {
    const { data, error } = await supabaseAdmin.from('sermons').select(SELECT)
      .order('preached_on', { ascending: false }).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const held = getUserRoles(who.user);
    return NextResponse.json({
      success: true,
      canManage: held.includes('Super Admin') || held.some((r) => SERMON_EDITORS.includes(r)),
      sermons: (data || []).map(shape),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (tableMissing(error)) return bad(SERMONS_MIGRATION_NOTE, 503);
    console.error('sermons GET:', error?.message || error);
    return bad('The sermons could not be loaded just now.', 500);
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const who = await requireRole(body.actorId, SERMON_EDITORS);
  if (who.error) return bad(who.error, who.status);

  if (body.action === 'sign') {
    const format = sermonFormat(body.fileName);
    if (!format) return bad('Choose a PowerPoint (.pptx or .ppt) or a PDF.');
    if (Number(body.bytes) > SERMON_MAX_BYTES) return bad('That file is over 10 MB. Save the slides as a PDF, or make the pictures in them smaller, and try again.');
    let config;
    try { config = getCloudinaryConfig(); } catch { return bad('File uploads are not set up on this site yet.', 503); }
    // Raw files keep their extension in their public id. The name: the
    // sermon's own words, then a random tail so two uploads never collide.
    const stem = String(body.fileName).replace(/\.[^.]+$/, '').toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sermon';
    const publicId = `${SERMON_FOLDER}/${new Date().getFullYear()}/${stem}-${crypto.randomBytes(4).toString('hex')}.${format}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { public_id: publicId, timestamp };
    const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    const signature = crypto.createHash('sha1').update(`${toSign}${config.apiSecret}`).digest('hex');
    return NextResponse.json({
      success: true,
      publicId,
      uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/raw/upload`,
      fields: { ...params, api_key: config.apiKey, signature },
    });
  }

  if (body.action === 'create') {
    const checked = details(body);
    if (checked.error) return bad(checked.error);
    const file = body.file || {};
    const publicId = String(file.publicId || '');
    const format = sermonFormat(publicId);
    let cloudName;
    try { ({ cloudName } = getCloudinaryConfig()); } catch { return bad('File uploads are not set up on this site yet.', 503); }
    // Only a file this site signed for: in the sermons folder, on this cloud.
    const url = String(file.url || '');
    if (!format || !publicId.startsWith(`${SERMON_FOLDER}/`) || publicId.includes('..')
      || !url.startsWith(`https://res.cloudinary.com/${cloudName}/raw/upload/`) || !url.endsWith(`/${publicId}`)) {
      return bad('The uploaded file could not be matched. Please upload it again.');
    }
    try {
      const { data, error } = await supabaseAdmin.from('sermons').insert({
        ...checked.fields,
        file_url: url,
        file_public_id: publicId,
        file_name: line(file.name, 200) || publicId.split('/').pop(),
        file_format: format,
        file_bytes: Math.max(0, Math.round(Number(file.bytes) || 0)) || null,
        uploaded_by: who.user.id,
        uploaded_by_name: who.name,
      }).select(SELECT).single();
      if (error) throw error;
      await audit(who, 'upload_sermon', data.id, { title: data.title, preached_on: data.preached_on });
      return NextResponse.json({ success: true, sermon: shape(data) });
    } catch (error) {
      // The file is on Cloudinary already; without a row nobody can reach it.
      try { await deleteFromCloudinary(publicId, 'raw'); } catch { /* best effort */ }
      if (tableMissing(error)) return bad(SERMONS_MIGRATION_NOTE, 503);
      console.error('sermons create:', error?.message || error);
      return bad('The sermon could not be saved just now.', 500);
    }
  }

  return bad('Unknown action.');
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const who = await requireRole(body.actorId, SERMON_EDITORS);
  if (who.error) return bad(who.error, who.status);
  const checked = details(body);
  if (checked.error) return bad(checked.error);
  try {
    const { data, error } = await supabaseAdmin.from('sermons')
      .update({ ...checked.fields, updated_at: new Date().toISOString() })
      .eq('id', String(body.id || '')).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) return bad('That sermon was not found.', 404);
    await audit(who, 'edit_sermon', data.id, { title: data.title });
    return NextResponse.json({ success: true, sermon: shape(data) });
  } catch (error) {
    if (tableMissing(error)) return bad(SERMONS_MIGRATION_NOTE, 503);
    console.error('sermons PATCH:', error?.message || error);
    return bad('The sermon could not be saved just now.', 500);
  }
}

export async function DELETE(request) {
  const params = new URL(request.url).searchParams;
  const who = await requireRole(params.get('actorId'), SERMON_EDITORS);
  if (who.error) return bad(who.error, who.status);
  try {
    const { data, error } = await supabaseAdmin.from('sermons')
      .delete().eq('id', String(params.get('id') || '')).select('id, title, file_public_id').maybeSingle();
    if (error) throw error;
    if (!data) return bad('That sermon was not found.', 404);
    try { await deleteFromCloudinary(data.file_public_id, 'raw'); } catch (e) {
      console.error('sermons: file left on Cloudinary:', data.file_public_id, e?.message || e);
    }
    await audit(who, 'delete_sermon', data.id, { title: data.title });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (tableMissing(error)) return bad(SERMONS_MIGRATION_NOTE, 503);
    console.error('sermons DELETE:', error?.message || error);
    return bad('The sermon could not be deleted just now.', 500);
  }
}
