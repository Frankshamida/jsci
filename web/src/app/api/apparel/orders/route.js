import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isEventManager, isCommitteeMember, actorRoleLabel } from '@/lib/eventCommittee';
import {
  ORDER_STATUSES, STOCK_HELD_STATUSES, isOneSize, stockFor, stockDelta,
  newOrderNo, apparelMigrationMissing,
} from '@/lib/apparel';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { listVisibleChannels, paymentsForBasket, cashLabelForItem } from '@/lib/apparelPayments';

// The apparel order desk.
//
// One order is one basket - a jacket and two shirts ordered together are one
// thing for an Admin to receive, price and hand over. The lines snapshot the
// name, size and price at the time of ordering, so next year's price rise
// never rewrites what somebody already agreed to pay.
//
// Stock is committed the moment an order is placed and given back if it is
// cancelled or deleted. That is the only honest way to answer "is there a
// Medium left" when several people are ordering at once.

const ORDER_COLUMNS = 'id, order_no, user_id, ordered_by_name, ordered_by_role, contact, note, status, total, is_paid, paid_at, payment_method, payment_channel_id, payment_reference, payment_proof_url, handled_by, handled_at, created_at, updated_at';
const LINE_COLUMNS = 'id, order_id, item_id, item_name, category, size, unit_price, quantity, line_total';

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'The apparel tables are not in the database yet. Run supabase/migrations/committee_apparel.sql in the Supabase SQL editor.',
}, { status: 503 });

const DENIED = (message = 'Access denied.') => NextResponse.json({ success: false, message }, { status: 403 });
const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

// Anybody who may open the store: the committee, and the Admins who run it.
async function requireCommittee(actorId) {
  const actor = await findEventActor(actorId);
  if (!actor || actor.is_active === false) return null;
  return (isEventManager(actor) || isCommitteeMember(actor)) ? actor : null;
}

async function logAudit(actor, action, orderId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action,
      resource: 'apparel_order',
      resource_id: orderId ? String(orderId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// Move stock for a set of lines. `sign` is -1 to commit it to an order and +1
// to give it back. Items are read one at a time because each line's size lives
// inside that item's own jsonb list.
async function moveStock(lines, sign) {
  for (const line of lines) {
    if (!line.item_id) continue; // the garment has since been deleted
    const { data: item } = await supabase.from('apparel_items')
      .select('id, sizes, one_size_stock').eq('id', line.item_id).single();
    if (!item) continue;
    const patch = stockDelta(item, line.size, sign * (Number(line.quantity) || 0));
    await supabase.from('apparel_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', item.id);
  }
}

async function loadOrderWithLines(id) {
  const { data: order, error } = await supabase.from('apparel_orders').select(ORDER_COLUMNS).eq('id', id).single();
  if (error || !order) return null;
  const { data: lines } = await supabase.from('apparel_order_items').select(LINE_COLUMNS).eq('order_id', id).order('created_at', { ascending: true });
  return { ...order, lines: lines || [] };
}

async function recomputeTotal(orderId) {
  const { data: lines } = await supabase.from('apparel_order_items').select('line_total').eq('order_id', orderId);
  const total = (lines || []).reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
  await supabase.from('apparel_orders').update({ total, updated_at: new Date().toISOString() }).eq('id', orderId);
  return total;
}

// GET ?actorId=..&mine=1                 -> the caller's own orders
//     ?actorId=..&all=1[&status=..&q=..] -> every order (Admins)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const wantsAll = searchParams.get('all') === '1';

    const actor = wantsAll
      ? await requireManager(searchParams.get('actorId'))
      : await requireCommittee(searchParams.get('actorId'));
    if (!actor) {
      return DENIED(wantsAll
        ? 'Only Admins and Super Admins can see every apparel order.'
        : 'Only Event Committee members and Admins can order apparel.');
    }

    let query = supabase.from('apparel_orders').select(ORDER_COLUMNS).order('created_at', { ascending: false });
    if (!wantsAll) query = query.eq('user_id', actor.id);
    const status = searchParams.get('status');
    if (wantsAll && status && status !== 'all') query = query.eq('status', status);

    const { data: orders, error } = await query.limit(500);
    if (error) return apparelMigrationMissing(error.message) ? NEEDS_MIGRATION() : fail(error.message, 500);

    // The lines for every order on screen, in one read rather than one per row.
    const ids = (orders || []).map((o) => o.id);
    let lines = [];
    if (ids.length > 0) {
      const { data: rows } = await supabase.from('apparel_order_items').select(LINE_COLUMNS)
        .in('order_id', ids).order('created_at', { ascending: true });
      lines = rows || [];
    }

    let data = (orders || []).map((o) => ({ ...o, lines: lines.filter((l) => l.order_id === o.id) }));

    // Searching an order desk means searching who ordered, the reference, or
    // what is in the basket - so it runs over the lines too.
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    if (q) {
      data = data.filter((o) => [o.order_no, o.ordered_by_name, o.contact, o.note, o.payment_method, o.payment_reference]
        .some((v) => String(v || '').toLowerCase().includes(q))
        || o.lines.some((l) => String(l.item_name || '').toLowerCase().includes(q)));
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error.message, 500);
  }
}

// POST { actorId, contact, note, lines: [{ itemId, size, quantity }], ... }
//
// JSON, or multipart when a receipt comes with it: paying through a channel
// means uploading the screenshot, the same way registering for a paid event
// does. Cash never has one.
async function readOrderBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return { body: await request.json(), proofUrl: null };
  }
  const form = await request.formData();
  const body = {};
  for (const [k, v] of form.entries()) { if (k !== 'proof') body[k] = v; }
  if (typeof body.lines === 'string') { try { body.lines = JSON.parse(body.lines); } catch { body.lines = []; } }
  body.payCash = body.payCash === 'true' || body.payCash === true;

  let proofUrl = null;
  const file = form.get('proof');
  if (file && typeof file === 'object' && file.size > 0) {
    const uploaded = await uploadBufferToCloudinary(await file.arrayBuffer(), {
      fileName: file.name || 'apparel-receipt',
      mimeType: file.type || 'image/jpeg',
      folder: 'JSCI-System/apparel-payments',
      // 'auto', not 'image': the checkout accepts whatever receipt the payer
      // has, and a PDF sent to the image endpoint is rejected outright.
      resourceType: 'auto',
    });
    proofUrl = uploaded.secureUrl;
  }
  return { body, proofUrl };
}

export async function POST(request) {
  try {
    const { body, proofUrl } = await readOrderBody(request);
    const actor = await requireCommittee(body.actorId);
    if (!actor) return DENIED('Only Event Committee members and Admins can order apparel.');

    const asked = Array.isArray(body.lines) ? body.lines : [];
    if (asked.length === 0) return fail('Your order is empty');

    // Price and stock are read from the database, never from the basket the
    // client sent - otherwise a tampered form could set its own price.
    const itemIds = [...new Set(asked.map((l) => l.itemId).filter(Boolean))];
    const { data: items, error: itemsErr } = await supabase.from('apparel_items')
      .select('id, name, category, price, sizes, one_size_stock, is_active, payment_method_ids, allow_cash, cash_label')
      .in('id', itemIds);
    if (itemsErr) return apparelMigrationMissing(itemsErr.message) ? NEEDS_MIGRATION() : fail(itemsErr.message, 500);

    const byId = new Map((items || []).map((i) => [i.id, i]));

    // Two people ordering the same size at once, or one basket listing it
    // twice, must both be counted against the same stock figure.
    const wanted = new Map();
    const lines = [];
    for (const line of asked) {
      const item = byId.get(line.itemId);
      if (!item) return fail('One of the items is no longer in the catalogue. Refresh the store and try again.');
      if (item.is_active === false) return fail(`${item.name} is no longer available.`);

      const quantity = Math.max(1, Math.trunc(Number(line.quantity) || 0));
      const size = isOneSize(item) ? null : String(line.size || '').trim();
      if (!isOneSize(item) && !size) return fail(`Choose a size for ${item.name}.`);

      const key = `${item.id}::${(size || '').toLowerCase()}`;
      const running = (wanted.get(key) || 0) + quantity;
      wanted.set(key, running);

      const available = stockFor(item, size);
      if (running > available) {
        return fail(available === 0
          ? `${item.name}${size ? ` (${size})` : ''} is out of stock.`
          : `Only ${available} left of ${item.name}${size ? ` (${size})` : ''}.`);
      }

      const unitPrice = Math.max(0, Number(item.price) || 0);
      lines.push({
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        size: size || null,
        unit_price: unitPrice,
        quantity,
        line_total: unitPrice * quantity,
      });
    }

    const total = lines.reduce((sum, l) => sum + l.line_total, 0);

    // ---- How this is being paid ----
    // The LABEL is resolved here, from what the items in this basket actually
    // accept. The browser sends an id and a flag, never the words - so an
    // order can never claim to have been paid through a channel the garment
    // does not take.
    let paymentMethod = null;
    let paymentChannelId = null;
    let paymentProof = null;
    if (total > 0) {
      const basket = [...new Set(lines.map((l) => l.item_id))].map((id) => byId.get(id)).filter(Boolean);
      const visible = await listVisibleChannels();
      const allowed = paymentsForBasket(basket, visible);

      if (body.payCash) {
        if (!allowed.cash) return fail('Cash is not accepted for everything in your basket.');
        paymentMethod = cashLabelForItem(basket[0]);
      } else if (body.paymentChannelId) {
        const channel = allowed.channels.find((c) => String(c.id) === String(body.paymentChannelId));
        if (!channel) {
          return fail(allowed.channels.length === 0
            ? 'Everything in your basket has to be paid a different way. Order these items separately.'
            : 'That payment channel is not accepted for everything in your basket.');
        }
        // Paying into an account means proving it arrived, exactly as
        // registering for a paid event does.
        if (!proofUrl) return fail('Upload a screenshot of your payment receipt.');
        paymentMethod = channel.name;
        paymentChannelId = channel.id;
        paymentProof = proofUrl;
      } else {
        return fail('Choose how you are paying');
      }
    }

    const { data: order, error } = await supabase.from('apparel_orders').insert({
      order_no: newOrderNo(),
      user_id: actor.id,
      ordered_by_name: `${actor.firstname || ''} ${actor.lastname || ''}`.trim() || null,
      ordered_by_role: actorRoleLabel(actor),
      contact: String(body.contact || '').trim() || null,
      note: String(body.note || '').trim() || null,
      status: 'pending',
      total,
      payment_method: paymentMethod,
      payment_channel_id: paymentChannelId,
      payment_reference: String(body.paymentReference || '').trim() || null,
      payment_proof_url: paymentProof,
    }).select(ORDER_COLUMNS).single();
    if (error) return apparelMigrationMissing(error.message) ? NEEDS_MIGRATION() : fail(error.message, 500);

    const { error: linesErr } = await supabase.from('apparel_order_items')
      .insert(lines.map((l) => ({ ...l, order_id: order.id })));
    if (linesErr) {
      // An order with no lines in it is worse than no order, so it goes.
      await supabase.from('apparel_orders').delete().eq('id', order.id);
      return fail(linesErr.message, 500);
    }

    await moveStock(lines, -1);
    await logAudit(actor, 'apparel_order_create', order.id, `Ordered ${lines.length} item line${lines.length === 1 ? '' : 's'} (${order.order_no})`);

    // The Admins who fulfil these should not have to go looking for new ones.
    try {
      const { data: managers } = await supabase.from('users').select('id').in('role', ['Admin', 'Super Admin']).eq('is_active', true);
      if (managers?.length) {
        await supabase.from('notifications').insert(managers.map((m) => ({
          user_id: m.id,
          title: '👕 New apparel order',
          message: `${order.ordered_by_name || 'A committee member'} ordered ${lines.length} item line${lines.length === 1 ? '' : 's'} (${order.order_no}).`,
          type: 'info',
          link: 'events',
        })));
      }
    } catch { /* the order stands whether or not anyone was told */ }

    return NextResponse.json({
      success: true,
      data: await loadOrderWithLines(order.id),
      message: `Order ${order.order_no} placed`,
    });
  } catch (error) {
    return fail(error.message, 500);
  }
}

// PUT { actorId, id, status? | isPaid? | note? | contact? }
//     { actorId, lineId, quantity? | size? }   -> edit one line of an order
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await findEventActor(body.actorId);
    if (!actor || actor.is_active === false) return DENIED('Could not tell who is signed in. Please sign out and sign in again.');
    const manager = isEventManager(actor);
    if (!manager && !isCommitteeMember(actor)) return DENIED('Only Event Committee members and Admins can do this.');

    // ---- Editing one line ----
    if (body.lineId) {
      if (!manager) return DENIED('Only Admins and Super Admins can change what is on an order.');
      const { data: line } = await supabase.from('apparel_order_items').select(LINE_COLUMNS).eq('id', body.lineId).single();
      if (!line) return fail('Order line not found', 404);
      const { data: order } = await supabase.from('apparel_orders').select('id, order_no, status').eq('id', line.order_id).single();
      if (!order) return fail('Order not found', 404);

      const nextQty = body.quantity === undefined
        ? line.quantity
        : Math.max(1, Math.trunc(Number(body.quantity) || 0));
      const nextSize = body.size === undefined ? line.size : (String(body.size || '').trim() || null);

      // The stock has to end up matching the new line, so the old one is given
      // back and the new one taken - which also proves the new one is there.
      const held = STOCK_HELD_STATUSES.includes(order.status);
      if (held && line.item_id) {
        const { data: item } = await supabase.from('apparel_items').select('id, name, sizes, one_size_stock').eq('id', line.item_id).single();
        if (item) {
          // Available AS IF this line had not been placed.
          const availableNow = stockFor(item, nextSize)
            + (String(nextSize || '').toLowerCase() === String(line.size || '').toLowerCase() ? line.quantity : 0);
          if (nextQty > availableNow) {
            return fail(`Only ${availableNow} left of ${item.name}${nextSize ? ` (${nextSize})` : ''}.`);
          }
        }
        await moveStock([line], +1);
        await moveStock([{ ...line, size: nextSize, quantity: nextQty }], -1);
      }

      const { data: saved, error } = await supabase.from('apparel_order_items').update({
        quantity: nextQty,
        size: nextSize,
        line_total: (Number(line.unit_price) || 0) * nextQty,
      }).eq('id', line.id).select(LINE_COLUMNS).single();
      if (error) return fail(error.message, 500);

      await recomputeTotal(line.order_id);
      await logAudit(actor, 'apparel_order_line_update', line.order_id, `${order.order_no}: ${line.item_name} → ${nextQty} × ${nextSize || 'One size'}`);
      return NextResponse.json({ success: true, data: await loadOrderWithLines(line.order_id), line: saved, message: 'Order updated' });
    }

    // ---- Editing the order itself ----
    if (!body.id) return fail('id required');
    const current = await loadOrderWithLines(body.id);
    if (!current) return fail('Order not found', 404);

    const isOwner = String(current.user_id) === String(actor.id);
    // A member may call off their OWN order while nobody has acted on it yet.
    // Everything else about an order is the desk's to change.
    const ownerCancelling = !manager && isOwner
      && body.status === 'cancelled' && current.status === 'pending'
      && body.isPaid === undefined && body.note === undefined && body.contact === undefined;
    if (!manager && !ownerCancelling) {
      return DENIED(isOwner
        ? 'You can only cancel your own order while it is still pending.'
        : 'Only Admins and Super Admins can change an order.');
    }

    const patch = {};
    if (body.status !== undefined) {
      if (!ORDER_STATUSES.includes(body.status)) return fail('Unknown status');
      patch.status = body.status;
    }
    if (manager && body.isPaid !== undefined) {
      patch.is_paid = !!body.isPaid;
      patch.paid_at = body.isPaid ? new Date().toISOString() : null;
    }
    if (manager && body.note !== undefined) patch.note = String(body.note || '').trim() || null;
    if (manager && body.contact !== undefined) patch.contact = String(body.contact || '').trim() || null;
    if (manager && body.paymentReference !== undefined) {
      patch.payment_reference = String(body.paymentReference || '').trim() || null;
    }
    // Correcting how it was paid, resolved against what the items on the order
    // accept - the same rule the payer was held to.
    if (manager && (body.payCash !== undefined || body.paymentChannelId !== undefined)) {
      const itemIds = [...new Set(current.lines.map((l) => l.item_id).filter(Boolean))];
      const { data: rows } = await supabase.from('apparel_items')
        .select('id, allow_cash, cash_label, payment_method_ids').in('id', itemIds);
      const visible = await listVisibleChannels();
      const allowed = paymentsForBasket(rows || [], visible);
      if (body.payCash) {
        patch.payment_method = (rows || []).length > 0 ? cashLabelForItem(rows[0]) : 'Cash';
        patch.payment_channel_id = null;
      } else if (body.paymentChannelId) {
        const channel = allowed.channels.find((c) => String(c.id) === String(body.paymentChannelId));
        if (!channel) return fail('That payment channel is not accepted for this order.');
        patch.payment_method = channel.name;
        patch.payment_channel_id = channel.id;
      }
    }

    if (Object.keys(patch).length === 0) return fail('Nothing to change');

    // Stock follows the status: cancelling gives it back, un-cancelling takes
    // it again - and can fail, if somebody else has taken it meanwhile.
    const wasHeld = STOCK_HELD_STATUSES.includes(current.status);
    const willHold = patch.status ? STOCK_HELD_STATUSES.includes(patch.status) : wasHeld;
    if (wasHeld && !willHold) {
      await moveStock(current.lines, +1);
    } else if (!wasHeld && willHold) {
      for (const line of current.lines) {
        if (!line.item_id) continue;
        const { data: item } = await supabase.from('apparel_items').select('id, name, sizes, one_size_stock').eq('id', line.item_id).single();
        if (item && line.quantity > stockFor(item, line.size)) {
          return fail(`Cannot reopen this order: only ${stockFor(item, line.size)} left of ${item.name}${line.size ? ` (${line.size})` : ''}.`);
        }
      }
      await moveStock(current.lines, -1);
    }

    if (manager && patch.status) {
      patch.handled_by = actor.id;
      patch.handled_at = new Date().toISOString();
    }

    const { data, error } = await supabase.from('apparel_orders')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', body.id).select(ORDER_COLUMNS).single();
    if (error) return apparelMigrationMissing(error.message) ? NEEDS_MIGRATION() : fail(error.message, 500);

    await logAudit(actor, 'apparel_order_update', data.id,
      `${data.order_no}: ${Object.entries(patch).filter(([k]) => !['handled_by', 'handled_at'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', ')}`);

    // Whoever ordered it should hear that it moved, without having to look.
    if (manager && patch.status && !isOwner) {
      try {
        await supabase.from('notifications').insert({
          user_id: data.user_id,
          title: '👕 Apparel order update',
          message: `Your order ${data.order_no} is now ${patch.status === 'ready' ? 'ready for pickup' : patch.status}.`,
          type: patch.status === 'cancelled' ? 'warning' : 'success',
          link: 'my-profile',
        });
      } catch { /* courtesy only */ }
    }

    return NextResponse.json({ success: true, data: await loadOrderWithLines(data.id), message: 'Order updated' });
  } catch (error) {
    return fail(error.message, 500);
  }
}

// DELETE ?id=..&actorId=..  -> remove an order for good, stock given back
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return DENIED('Only Admins and Super Admins can delete an order.');
    const id = searchParams.get('id');
    if (!id) return fail('id required');

    const order = await loadOrderWithLines(id);
    if (!order) return fail('Order not found', 404);

    if (STOCK_HELD_STATUSES.includes(order.status)) await moveStock(order.lines, +1);

    // The lines go with it - apparel_order_items cascades on the foreign key.
    const { error } = await supabase.from('apparel_orders').delete().eq('id', id);
    if (error) return fail(error.message, 500);

    await logAudit(actor, 'apparel_order_delete', id, `Deleted order ${order.order_no}`);
    return NextResponse.json({ success: true, message: `Order ${order.order_no} deleted` });
  } catch (error) {
    return fail(error.message, 500);
  }
}
