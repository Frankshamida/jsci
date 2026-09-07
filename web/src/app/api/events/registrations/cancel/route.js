import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { cacheInvalidate } from '@/lib/serverCache';

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];
const PENDING_ALERTS_KEY = 'events:pending-registrations';

async function findActor(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    return data || null;
  } catch { return null; }
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action, resource: 'event_registration',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// Two WORKING days from now: Saturday and Sunday are not days the office can
// move money on, so they are stepped over rather than counted.
function resolveRefundDueAt(from = new Date()) {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < 2) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString();
}

// What the member is owed back. A flexible plan has only paid part of the fee,
// so the refund follows what actually arrived, never what was owed.
function refundableAmount(reg) {
  const paid = Number(reg.amount_paid || 0);
  if (paid > 0) return paid;
  return reg.status === 'payment_verified' || reg.status === 'installment' ? Number(reg.amount || 0) : 0;
}

// POST — a member asks to cancel their own registration.
// { registrationId, userId, reason }
export async function POST(request) {
  try {
    const body = await request.json();
    const { registrationId, userId, reason } = body || {};
    if (!registrationId || !userId) {
      return NextResponse.json({ success: false, message: 'registrationId and userId are required.' }, { status: 400 });
    }

    const { data: reg, error } = await supabase
      .from('event_registrations')
      .select('*')
      .eq('id', registrationId)
      .single();
    if (error || !reg) return NextResponse.json({ success: false, message: 'Registration not found.' }, { status: 404 });

    // Only over your own registration, and only one that is still live.
    if (String(reg.user_id) !== String(userId)) {
      return NextResponse.json({ success: false, message: 'This is not your registration.' }, { status: 403 });
    }
    if (reg.deleted_at || reg.status === 'cancelled') {
      return NextResponse.json({ success: false, message: 'This registration is already cancelled.' }, { status: 400 });
    }
    if (reg.cancel_status === 'requested') {
      return NextResponse.json({ success: false, message: 'You have already requested to cancel this registration.' }, { status: 400 });
    }

    const refundDueAt = resolveRefundDueAt();
    const { error: upErr } = await supabase
      .from('event_registrations')
      .update({
        cancel_status: 'requested',
        cancel_requested_at: new Date().toISOString(),
        cancel_reason: (reason || '').trim() || null,
        refund_due_at: refundDueAt,
        // a fresh request wipes whatever a previous decline left behind
        cancel_reviewed_at: null,
        cancel_reviewed_by: null,
        cancel_reviewed_by_name: null,
      })
      .eq('id', registrationId);
    if (upErr) throw upErr;

    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit({ id: userId }, 'request_cancel_registration', registrationId, reason || null);

    return NextResponse.json({
      success: true,
      refundDueAt,
      refundAmount: refundableAmount(reg),
      message: 'Cancellation requested. An admin will process your refund within 2 working days.',
    });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

// DELETE — the member changes their mind and withdraws the request.
// ?id=<registrationId>&userId=<userId>
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    if (!id || !userId) return NextResponse.json({ success: false, message: 'id and userId are required.' }, { status: 400 });

    const { data: reg } = await supabase.from('event_registrations').select('id, user_id, cancel_status').eq('id', id).single();
    if (!reg) return NextResponse.json({ success: false, message: 'Registration not found.' }, { status: 404 });
    if (String(reg.user_id) !== String(userId)) {
      return NextResponse.json({ success: false, message: 'This is not your registration.' }, { status: 403 });
    }
    if (reg.cancel_status !== 'requested') {
      return NextResponse.json({ success: false, message: 'There is no open cancellation request to withdraw.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('event_registrations')
      .update({ cancel_status: null, cancel_requested_at: null, cancel_reason: null, refund_due_at: null })
      .eq('id', id);
    if (error) throw error;

    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit({ id: userId }, 'withdraw_cancel_registration', id, null);
    return NextResponse.json({ success: true, message: 'Cancellation request withdrawn. Your registration stands.' });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

// GET — the admin queue of open requests. ?actorId=<admin>[&eventId=]
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await findActor(searchParams.get('actorId'));
    if (!actor || !EVENT_MANAGER_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }
    let q = supabase
      .from('event_registrations')
      .select('id, event_id, attendee_name, status, amount, amount_paid, payment_method, payment_reference, cancel_status, cancel_reason, cancel_requested_at, refund_due_at, event:events(id, title)')
      .eq('cancel_status', 'requested')
      .is('deleted_at', null)
      .order('cancel_requested_at', { ascending: true });
    const eventId = searchParams.get('eventId');
    if (eventId) q = q.eq('event_id', eventId);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ success: true, count: (data || []).length, data: data || [] });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

// PATCH — an admin settles the request.
// { registrationId, actorId, action: 'refund' | 'decline', refundAmount?, refundReference?, note? }
//
// 'refund' is the end of the line: the money goes back, the registration is
// cancelled, and the row is moved to the recycle bin so the slot is released
// while the paper trail survives.
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { registrationId, actorId, action, refundAmount, refundReference, note } = body || {};
    const actor = await findActor(actorId);
    if (!actor || !EVENT_MANAGER_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }
    if (!registrationId || !['refund', 'decline'].includes(action)) {
      return NextResponse.json({ success: false, message: 'registrationId and a valid action are required.' }, { status: 400 });
    }

    const { data: reg } = await supabase.from('event_registrations').select('*').eq('id', registrationId).single();
    if (!reg) return NextResponse.json({ success: false, message: 'Registration not found.' }, { status: 404 });
    if (reg.cancel_status !== 'requested') {
      return NextResponse.json({ success: false, message: 'There is no open cancellation request on this registration.' }, { status: 400 });
    }

    const actorName = `${actor.firstname} ${actor.lastname}`.trim();
    const now = new Date().toISOString();

    if (action === 'decline') {
      const { error } = await supabase
        .from('event_registrations')
        .update({
          cancel_status: 'declined',
          cancel_reviewed_at: now,
          cancel_reviewed_by: actor.id,
          cancel_reviewed_by_name: actorName,
          refund_note: (note || '').trim() || null,
        })
        .eq('id', registrationId);
      if (error) throw error;
      cacheInvalidate(PENDING_ALERTS_KEY);
      await logAudit(actor, 'decline_cancel_registration', registrationId, note || null);
      return NextResponse.json({ success: true, message: 'Cancellation declined. The registration stands.' });
    }

    const amount = refundAmount != null && refundAmount !== '' ? Number(refundAmount) : refundableAmount(reg);
    const { error } = await supabase
      .from('event_registrations')
      .update({
        cancel_status: 'refunded',
        cancel_reviewed_at: now,
        cancel_reviewed_by: actor.id,
        cancel_reviewed_by_name: actorName,
        refund_amount: Number.isFinite(amount) ? amount : 0,
        refund_reference: (refundReference || '').trim() || null,
        refund_note: (note || '').trim() || null,
        // Refunded means it is over: the seat goes back to the event and the row
        // goes to the recycle bin, where a delete can still be undone.
        status: 'cancelled',
        deleted_at: now,
        deleted_by: actor.id,
        deleted_by_name: actorName,
        deleted_reason: 'Cancelled at the attendee\'s request, refund processed.',
      })
      .eq('id', registrationId);
    if (error) throw error;

    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit(actor, 'refund_cancel_registration', registrationId, `₱${amount}${refundReference ? ` · ref ${refundReference}` : ''}`);
    return NextResponse.json({ success: true, message: 'Refund recorded and the registration was cancelled.' });
  } catch (e) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
