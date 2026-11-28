import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole, ADMIN_ROLES } from '@/lib/actor';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '@/lib/cloudinary';
import {
  DEV_MAX, DEV_PHOTO, DEV_LIMITS, DEVELOPERS_MIGRATION_NOTE, isRoleIcon, shapeDeveloper, shapeDevSettings,
} from '@/lib/developers';

export const dynamic = 'force-dynamic';
// Every read fresh: force-dynamic alone does not keep Next 14 from caching the
// database reads of a route.
export const revalidate = 0;

// ============================================================
// /api/developers - the "Meet the Developers" window (components/developers)
//   GET                              the website: active developers in order,
//                                    and the window's words (cached 60 s)
//   GET    ?manage=1&actorId=..      Dashboard > Developers: every developer,
//                                    hidden ones too
//   POST   multipart: actorId, id?, surname, givenNames, role, roleIcon,
//          active, photo? (the cropped 700 x 1000 image), removePhoto?
//                                    adds one (no id) or changes one
//   PATCH  { actorId, action: 'reorder', ids }
//          { actorId, action: 'active', id, active }
//          { actorId, action: 'settings', badge, headline, description, autoShow }
//   DELETE ?actorId=..&id=..         removes one, and its photo
// Changes are for Admins and Super Admins (requireRole). A photo replaced or
// removed is deleted from Cloudinary too.
// ============================================================

const DEVS = 'site_developers';
const SETTINGS = 'site_developer_settings';
const COLUMNS = 'id, surname, given_names, role, role_icon, photo_url, photo_public_id, sort_order, is_active, created_at';

const bad = (message, status = 400, extra = {}) => NextResponse.json({ success: false, message, ...extra }, { status });
const tableMissing = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205'
  || (/site_developer/.test(String(error.message || '')) && /does not exist|schema cache|not find/i.test(String(error.message || ''))));
const missing = () => bad(DEVELOPERS_MIGRATION_NOTE, 503, { code: 'NEEDS_MIGRATION' });
const oops = (where, error) => {
  if (tableMissing(error)) return missing();
  console.error(`developers ${where}:`, error?.message || error);
  return bad('Something went wrong on our side. Please try again in a moment.', 500);
};

// One line of text: no tags, no angle brackets, single spaces.
const line = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

async function readAll(activeOnly) {
  let q = supabaseAdmin.from(DEVS).select(COLUMNS).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const [devs, settings] = await Promise.all([q, supabaseAdmin.from(SETTINGS).select('*').eq('id', 1).maybeSingle()]);
  if (devs.error) throw devs.error;
  if (settings.error) throw settings.error;
  return { developers: (devs.data || []).map(shapeDeveloper), settings: shapeDevSettings(settings.data) };
}

async function audit(who, action, id, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: who.user.id, user_name: who.name, action, resource: 'developers', resource_id: id ? String(id) : null, details: details || null,
    });
  } catch { /* non-fatal */ }
}

async function dropPhoto(publicId) {
  if (!publicId) return;
  try { await deleteFromCloudinary(publicId, 'image'); } catch (e) { console.error('developers: photo not removed:', e?.message || e); }
}

// ---------------------------------------------------------------- GET
export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  if (sp.get('manage')) {
    const who = await requireRole(sp.get('actorId'), ADMIN_ROLES);
    if (who.error) return bad(who.error, who.status);
    try {
      const data = await readAll(false);
      return NextResponse.json({ success: true, max: DEV_MAX, ...data }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      return oops('GET manage', error);
    }
  }
  try {
    const data = await readAll(true);
    return NextResponse.json({ success: true, ...data }, {
      // The same answer for every visitor: the edge keeps it a minute.
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    return oops('GET', error);
  }
}

// ---------------------------------------------------------------- POST (add / change one)
export async function POST(request) {
  let form;
  try { form = await request.formData(); } catch { return bad('That request could not be read. Please try again.'); }
  const who = await requireRole(form.get('actorId'), ADMIN_ROLES);
  if (who.error) return bad(who.error, who.status);

  const id = line(form.get('id'), 64) || null;
  const surname = line(form.get('surname'), DEV_LIMITS.surname).toUpperCase();
  const givenNames = line(form.get('givenNames'), DEV_LIMITS.givenNames);
  const role = line(form.get('role'), DEV_LIMITS.role);
  const roleIcon = String(form.get('roleIcon') || 'code');
  const active = String(form.get('active') ?? 'true') !== 'false';
  const removePhoto = String(form.get('removePhoto') || '') === 'true';
  const photo = form.get('photo');
  if (!surname) return bad('Type the surname.');
  if (!role) return bad('Type the role, for example Full Stack Developer.');
  if (!isRoleIcon(roleIcon)) return bad('Pick an icon for the role.');

  const hasPhoto = photo && typeof photo === 'object' && typeof photo.arrayBuffer === 'function' && photo.size > 0;
  if (hasPhoto) {
    if (!DEV_PHOTO.accept.includes(photo.type)) return bad('The photo must be a JPG, PNG or WebP image.');
    if (photo.size > DEV_PHOTO.maxUploadBytes) return bad('That photo is too large. Crop it again and save.');
  }

  try {
    let before = null;
    if (id) {
      const { data, error } = await supabaseAdmin.from(DEVS).select(COLUMNS).eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return bad('That developer was removed. Refresh the page.', 404);
      before = data;
    } else {
      const { count, error } = await supabaseAdmin.from(DEVS).select('id', { count: 'exact', head: true });
      if (error) throw error;
      if ((count || 0) >= DEV_MAX) return bad(`The window shows up to ${DEV_MAX} developers. Remove one first.`);
    }

    // The new photo goes up first: a failed upload changes nothing.
    let uploaded = null;
    if (hasPhoto) {
      const ext = photo.type === 'image/webp' ? 'webp' : photo.type === 'image/png' ? 'png' : 'jpg';
      uploaded = await uploadBufferToCloudinary(await photo.arrayBuffer(), {
        fileName: `${surname.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'developer'}.${ext}`,
        mimeType: photo.type,
        folder: DEV_PHOTO.folder,
        resourceType: 'image',
        transformation: null, // already cropped and sized in the browser
      });
    }

    const fields = {
      surname, given_names: givenNames, role, role_icon: roleIcon, is_active: active, updated_at: new Date().toISOString(),
    };
    if (uploaded) { fields.photo_url = uploaded.optimizedUrl || uploaded.secureUrl; fields.photo_public_id = uploaded.publicId; }
    else if (removePhoto) { fields.photo_url = null; fields.photo_public_id = null; }

    let row;
    if (id) {
      const { data, error } = await supabaseAdmin.from(DEVS).update(fields).eq('id', id).select(COLUMNS).single();
      if (error) { if (uploaded) await dropPhoto(uploaded.publicId); throw error; }
      row = data;
      if ((uploaded || removePhoto) && before.photo_public_id && before.photo_public_id !== row.photo_public_id) await dropPhoto(before.photo_public_id);
    } else {
      const { data: last } = await supabaseAdmin.from(DEVS).select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await supabaseAdmin.from(DEVS).insert({ ...fields, sort_order: (last?.sort_order ?? -1) + 1 }).select(COLUMNS).single();
      if (error) { if (uploaded) await dropPhoto(uploaded.publicId); throw error; }
      row = data;
    }
    await audit(who, id ? 'developer_updated' : 'developer_added', row.id, `${row.surname}, ${row.given_names}`);
    return NextResponse.json({ success: true, developer: shapeDeveloper(row) });
  } catch (error) {
    if (/cloudinary/i.test(String(error?.message || '')) || error?.message === 'Cloudinary upload failed') {
      console.error('developers POST upload:', error?.message || error);
      return bad('The photo could not be uploaded. Check your connection and try again.', 502);
    }
    return oops('POST', error);
  }
}

// ---------------------------------------------------------------- PATCH (order, shown, settings)
export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const who = await requireRole(body.actorId, ADMIN_ROLES);
  if (who.error) return bad(who.error, who.status);
  try {
    if (body.action === 'reorder') {
      const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).slice(0, 50) : [];
      if (!ids.length) return bad('Nothing to reorder.');
      const results = await Promise.all(ids.map((devId, i) => supabaseAdmin.from(DEVS).update({ sort_order: i }).eq('id', devId)));
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
      await audit(who, 'developers_reordered', null, null);
      return NextResponse.json({ success: true });
    }
    if (body.action === 'active') {
      const { data, error } = await supabaseAdmin.from(DEVS).update({ is_active: !!body.active, updated_at: new Date().toISOString() })
        .eq('id', String(body.id || '')).select(COLUMNS).maybeSingle();
      if (error) throw error;
      if (!data) return bad('That developer was removed. Refresh the page.', 404);
      await audit(who, body.active ? 'developer_shown' : 'developer_hidden', data.id, data.surname);
      return NextResponse.json({ success: true, developer: shapeDeveloper(data) });
    }
    if (body.action === 'settings') {
      const headline = line(body.headline, DEV_LIMITS.headline);
      if (!headline) return bad('Type a headline.');
      const fields = {
        id: 1,
        badge: line(body.badge, DEV_LIMITS.badge),
        headline,
        description: line(body.description, DEV_LIMITS.description),
        auto_show: body.autoShow !== false,
        updated_by: who.user.id,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseAdmin.from(SETTINGS).upsert(fields, { onConflict: 'id' }).select('*').single();
      if (error) throw error;
      await audit(who, 'developer_settings_updated', null, null);
      return NextResponse.json({ success: true, settings: shapeDevSettings(data) });
    }
    return bad('Unknown action.');
  } catch (error) {
    return oops('PATCH', error);
  }
}

// ---------------------------------------------------------------- DELETE
export async function DELETE(request) {
  const sp = new URL(request.url).searchParams;
  const who = await requireRole(sp.get('actorId'), ADMIN_ROLES);
  if (who.error) return bad(who.error, who.status);
  const id = String(sp.get('id') || '');
  if (!id) return bad('Pick a developer to remove.');
  try {
    const { data, error } = await supabaseAdmin.from(DEVS).delete().eq('id', id).select('id, surname, photo_public_id').maybeSingle();
    if (error) throw error;
    if (!data) return bad('That developer was already removed.', 404);
    await dropPhoto(data.photo_public_id);
    await audit(who, 'developer_deleted', data.id, data.surname);
    return NextResponse.json({ success: true });
  } catch (error) {
    return oops('DELETE', error);
  }
}
