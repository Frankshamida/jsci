import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { findEventActor, isEventManager, isCommitteeMember } from '@/lib/eventCommittee';
import {
  APPAREL_CATEGORIES, MAX_APPAREL_IMAGES, normalizeSizes, normalizeImages, apparelMigrationMissing,
} from '@/lib/apparel';
import { apparelIdList, listVisibleChannels } from '@/lib/apparelPayments';

// The committee apparel catalogue.
//
// Reading it is open to the committee - they are the customers. Changing it is
// an Admin's job, because a price and a stock count are money.

const COLUMNS = 'id, name, category, description, price, image_url, images, sizes, one_size_stock, payment_method_ids, allow_cash, cash_label, is_active, position, created_at, updated_at';

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'The apparel tables are not in the database yet. Run supabase/migrations/committee_apparel.sql in the Supabase SQL editor.',
}, { status: 503 });

const DENIED = (message = 'Access denied.') => NextResponse.json({ success: false, message }, { status: 403 });

// A manager may edit the catalogue. Anybody on the committee may read it.
async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}
async function requireCommittee(actorId) {
  const actor = await findEventActor(actorId);
  if (!actor || actor.is_active === false) return null;
  return (isEventManager(actor) || isCommitteeMember(actor)) ? actor : null;
}

async function logAudit(actor, action, itemId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action,
      resource: 'apparel_item',
      resource_id: itemId ? String(itemId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

async function uploadImage(file) {
  const buffer = await file.arrayBuffer();
  const uploaded = await uploadBufferToCloudinary(buffer, {
    fileName: file.name || 'apparel',
    mimeType: file.type || 'image/jpeg',
    folder: 'JSCI-System/committee-apparel',
    resourceType: 'image',
  });
  return uploaded.secureUrl;
}

// JSON, or multipart carrying new pictures. Same shape either way.
//
// Pictures arrive as two parallel lists: `newImage` files and the
// `newImageLabel` next to each one ("Front", "Back"). What the item ALREADY
// has comes back in `existingImages`, so relabelling or reordering a picture
// costs no upload - only genuinely new files are sent to Cloudinary.
async function readBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return { fields: await request.json(), uploaded: [] };
  }
  const form = await request.formData();
  const fields = {};
  for (const [k, v] of form.entries()) {
    if (k === 'newImage' || k === 'newImageLabel') continue;
    fields[k] = v;
  }

  const files = form.getAll('newImage').filter((f) => f && typeof f === 'object' && f.size > 0);
  const labels = form.getAll('newImageLabel').map((l) => String(l || '').trim());
  const uploaded = [];
  for (let i = 0; i < files.length && uploaded.length < MAX_APPAREL_IMAGES; i += 1) {
    uploaded.push({ url: await uploadImage(files[i]), label: labels[i] || '' });
  }
  return { fields, uploaded };
}

// The writable half of an item, from whatever the client sent. Unmentioned
// fields are left alone, so a PUT that only changes stock cannot blank a
// description by omission.
function itemPatch(fields, uploaded) {
  const patch = {};
  if (fields.name !== undefined) patch.name = String(fields.name).trim();
  if (fields.category !== undefined) {
    // An Admin may name a category the list has never heard of - see the
    // migration's note on why this is not an enum. Only a blank falls back.
    const asked = String(fields.category).trim().replace(/\s+/g, ' ').slice(0, 40);
    patch.category = asked || 'Other';
  }
  if (fields.description !== undefined) patch.description = String(fields.description || '').trim() || null;
  if (fields.price !== undefined) patch.price = Math.max(0, Number(fields.price) || 0);
  if (fields.sizes !== undefined) patch.sizes = normalizeSizes(fields.sizes);
  if (fields.oneSizeStock !== undefined) patch.one_size_stock = Math.max(0, Math.trunc(Number(fields.oneSizeStock) || 0));
  if (fields.isActive !== undefined) patch.is_active = fields.isActive === true || fields.isActive === 'true';

  // What this item may be paid with. Ids only - the accounts behind them live
  // in payment_methods, under Mode of Payment.
  if (fields.paymentMethodIds !== undefined) patch.payment_method_ids = apparelIdList(fields.paymentMethodIds);
  if (fields.allowCash !== undefined) patch.allow_cash = fields.allowCash === true || fields.allowCash === 'true';
  if (fields.cashLabel !== undefined) patch.cash_label = String(fields.cashLabel || '').trim().slice(0, 60) || null;
  if (fields.position !== undefined) patch.position = Math.trunc(Number(fields.position) || 0);

  // The pictures the item keeps, then the ones just uploaded, in the order the
  // Admin arranged them. image_url mirrors the first, so nothing that reads
  // one picture has to learn about the list.
  const kept = fields.existingImages !== undefined ? normalizeImages(fields.existingImages) : null;
  if (kept !== null || (uploaded && uploaded.length > 0)) {
    const images = [...(kept || []), ...(uploaded || [])].slice(0, MAX_APPAREL_IMAGES);
    patch.images = images;
    patch.image_url = images[0]?.url || null;
  } else if (fields.imageUrl !== undefined) {
    // The single-picture path, for a caller that knows nothing about the list.
    const one = String(fields.imageUrl || '').trim();
    patch.image_url = one || null;
    patch.images = one ? [{ url: one, label: '' }] : [];
  }
  return patch;
}

// GET ?actorId=..          -> the catalogue a committee member may order from
//     &all=1               -> including the retired items (managers only)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const wantsAll = searchParams.get('all') === '1';
    const actor = wantsAll
      ? await requireManager(searchParams.get('actorId'))
      : await requireCommittee(searchParams.get('actorId'));
    if (!actor) {
      return DENIED(wantsAll
        ? 'Only Admins and Super Admins can manage the apparel catalogue.'
        : 'Only Event Committee members and Admins can open the apparel store.');
    }

    let query = supabase.from('apparel_items').select(COLUMNS)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (!wantsAll) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) return apparelMigrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    // The built-in categories plus any an Admin has invented, so the store
    // and the item form can offer both without guessing.
    const used = [...new Set((data || []).map((i) => i.category).filter(Boolean))];
    const categories = [...APPAREL_CATEGORIES, ...used.filter((c) => !APPAREL_CATEGORIES.includes(c)).sort()];

    // Every channel a payer may be sent to, so the store can render the
    // options an item accepts without a second request, and the item form can
    // offer the full list to tick.
    const channels = await listVisibleChannels();

    return NextResponse.json({ success: true, data: data || [], categories, channels });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST { actorId, name, category, price, sizes, ... } (JSON or multipart)
export async function POST(request) {
  try {
    const { fields, uploaded } = await readBody(request);
    const actor = await requireManager(fields.actorId);
    if (!actor) return DENIED('Only Admins and Super Admins can add apparel.');

    const patch = itemPatch(fields, uploaded);
    if (!patch.name) return NextResponse.json({ success: false, message: 'A name is required' }, { status: 400 });

    const { data, error } = await supabase.from('apparel_items').insert({
      category: 'Shirt',
      price: 0,
      sizes: [],
      one_size_stock: 0,
      payment_method_ids: [],
      allow_cash: true,
      is_active: true,
      ...patch,
      created_by: actor.id,
    }).select(COLUMNS).single();
    if (error) return apparelMigrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    await logAudit(actor, 'apparel_item_create', data.id, `Added "${data.name}" to the committee apparel catalogue`);
    return NextResponse.json({ success: true, data, message: `${data.name} added` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT { actorId, id, ...changes } (JSON or multipart)
export async function PUT(request) {
  try {
    const { fields, uploaded } = await readBody(request);
    const actor = await requireManager(fields.actorId);
    if (!actor) return DENIED('Only Admins and Super Admins can edit apparel.');
    if (!fields.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const patch = itemPatch(fields, uploaded);
    if (Object.keys(patch).length === 0) return NextResponse.json({ success: false, message: 'Nothing to change' }, { status: 400 });
    if (patch.name === '') return NextResponse.json({ success: false, message: 'A name is required' }, { status: 400 });

    const { data, error } = await supabase.from('apparel_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', fields.id).select(COLUMNS).single();
    if (error) return apparelMigrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

    await logAudit(actor, 'apparel_item_update', data.id, `Updated "${data.name}"`);
    return NextResponse.json({ success: true, data, message: `${data.name} saved` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?id=..&actorId=..
//
// An item somebody has already ordered is RETIRED rather than deleted: the
// order lines snapshot the name and price, but the picture and the size list
// are still what an Admin looks at when filling that order. Retiring takes it
// out of the store and leaves the record intact.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return DENIED('Only Admins and Super Admins can delete apparel.');
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { data: item } = await supabase.from('apparel_items').select('id, name').eq('id', id).single();
    if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

    const { count } = await supabase.from('apparel_order_items')
      .select('id', { count: 'exact', head: true }).eq('item_id', id);

    if ((count || 0) > 0) {
      const { data, error } = await supabase.from('apparel_items')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id).select(COLUMNS).single();
      if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
      await logAudit(actor, 'apparel_item_retire', id, `Retired "${item.name}" (${count} order line${count === 1 ? '' : 's'} reference it)`);
      return NextResponse.json({
        success: true,
        data,
        retired: true,
        message: `${item.name} has been ordered before, so it was hidden from the store instead of deleted.`,
      });
    }

    const { error } = await supabase.from('apparel_items').delete().eq('id', id);
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    await logAudit(actor, 'apparel_item_delete', id, `Deleted "${item.name}"`);
    return NextResponse.json({ success: true, message: `${item.name} deleted` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
