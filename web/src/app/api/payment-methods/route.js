import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Only these roles may add / edit / remove payment channels.
const MANAGER_ROLES = ['Admin', 'Super Admin', 'Pastor'];

const CATEGORIES = ['bank', 'online'];

async function verifyManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    if (data && MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* ignore */ }
  return null;
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action, resource: 'payment_method',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// Which events reference each channel, keyed by payment method id. Events store
// the ids in a jsonb array, so the rows are read once and grouped here rather
// than running a query per channel.
async function usageByMethod() {
  const map = {};
  try {
    const { data } = await supabase
      .from('events')
      .select('id, title, event_date, is_active, payment_method_ids')
      .not('payment_method_ids', 'is', null)
      .order('event_date', { ascending: false });
    (data || []).forEach((evt) => {
      const ids = Array.isArray(evt.payment_method_ids) ? evt.payment_method_ids : [];
      ids.forEach((id) => {
        if (!map[id]) map[id] = [];
        map[id].push({ id: evt.id, title: evt.title, event_date: evt.event_date, is_active: evt.is_active });
      });
    });
  } catch { /* usage is informational - never block the listing */ }
  return map;
}

// Trim to null so empty inputs don't store empty strings.
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// GET                 -> active payment methods (public, for payers)
// GET ?actorId=..     -> all payment methods incl. inactive (managers only)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actorId = searchParams.get('actorId');
    const actor = actorId ? await verifyManager(actorId) : null;

    let query = supabase
      .from('payment_methods')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    // Without a verified manager, only expose the channels meant for payers.
    if (!actor) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;

    // Managers see where each channel is in use, so they know what a change or
    // a delete would affect.
    if (actor) {
      const usage = await usageByMethod();
      const withUsage = (data || []).map((m) => ({ ...m, used_by_events: usage[m.id] || [] }));
      return NextResponse.json({ success: true, data: withUsage, canManage: true });
    }

    return NextResponse.json({ success: true, data: data || [], canManage: false });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST { actorId, category, name, accountNumber, accountName, logoUrl, logoColor, notes, isActive, sortOrder }
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    if (!clean(body.name)) {
      return NextResponse.json({ success: false, message: 'Bank / channel name is required' }, { status: 400 });
    }
    const category = CATEGORIES.includes(body.category) ? body.category : 'bank';

    const { data, error } = await supabase.from('payment_methods').insert({
      category,
      name: clean(body.name),
      account_number: clean(body.accountNumber),
      account_name: clean(body.accountName),
      logo_url: clean(body.logoUrl),
      qr_url: clean(body.qrUrl),
      logo_color: clean(body.logoColor) || '#1e3a8a',
      notes: clean(body.notes),
      is_active: body.isActive !== false,
      sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      created_by: actor.id,
    }).select().single();
    if (error) throw error;

    await logAudit(actor, 'payment_method_create', data.id, `Added ${category} payment method "${data.name}"`);
    return NextResponse.json({ success: true, data, message: 'Payment method added' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PATCH { id, actorId, ...fields }  -> update one payment method
export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ success: false, message: 'id is required' }, { status: 400 });

    const actor = await verifyManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const update = { updated_at: new Date().toISOString() };
    if (body.category !== undefined) {
      if (!CATEGORIES.includes(body.category)) {
        return NextResponse.json({ success: false, message: 'Invalid category' }, { status: 400 });
      }
      update.category = body.category;
    }
    if (body.name !== undefined) {
      if (!clean(body.name)) return NextResponse.json({ success: false, message: 'Bank / channel name is required' }, { status: 400 });
      update.name = clean(body.name);
    }
    if (body.accountNumber !== undefined) update.account_number = clean(body.accountNumber);
    if (body.accountName !== undefined) update.account_name = clean(body.accountName);
    if (body.logoUrl !== undefined) update.logo_url = clean(body.logoUrl);
    if (body.qrUrl !== undefined) update.qr_url = clean(body.qrUrl);
    if (body.logoColor !== undefined) update.logo_color = clean(body.logoColor) || '#1e3a8a';
    if (body.notes !== undefined) update.notes = clean(body.notes);
    if (body.isActive !== undefined) update.is_active = !!body.isActive;
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) update.sort_order = Number(body.sortOrder);

    const { data, error } = await supabase.from('payment_methods').update(update).eq('id', body.id).select().single();
    if (error) throw error;

    await logAudit(actor, 'payment_method_update', body.id, `Updated payment method "${data.name}"`);
    return NextResponse.json({ success: true, data, message: 'Payment method updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?id=..&actorId=..
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id is required' }, { status: 400 });

    const actor = await verifyManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const { data: existing } = await supabase.from('payment_methods').select('name').eq('id', id).single();

    // Deleting a channel an event still points at would leave that event's
    // registrants with no account to pay into, and would strip the details from
    // registrations already made against it. Hiding is the safe alternative.
    const usage = (await usageByMethod())[id] || [];
    if (usage.length > 0) {
      return NextResponse.json({
        success: false,
        inUse: true,
        usedByEvents: usage,
        message: `"${existing?.name || 'This payment method'}" is used by ${usage.length} event${usage.length === 1 ? '' : 's'}. Remove it from those events first, or hide it instead so it stays on past registrations.`,
      }, { status: 409 });
    }

    const { error } = await supabase.from('payment_methods').delete().eq('id', id);
    if (error) throw error;

    await logAudit(actor, 'payment_method_delete', id, `Deleted payment method "${existing?.name || id}"`);
    return NextResponse.json({ success: true, message: 'Payment method deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
