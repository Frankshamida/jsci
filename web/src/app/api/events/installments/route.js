import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';

// Payments recorded against a registration that is being paid in installments.
// The registration still carries what is owed (`amount`); this route is about
// what has come in against it, and when.

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* ignore */ }
  return null;
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

// Re-add the payments for a registration and write the total back onto it. Done
// after every change so `amount_paid` can never drift from the rows behind it.
async function recomputePaid(registrationId) {
  const { data: reg } = await supabase
    .from('event_registrations')
    .select('id, amount, status, payment_plan')
    .eq('id', registrationId)
    .single();
  if (!reg) return null;

  const { data: rows } = await supabase
    .from('event_registration_payments')
    .select('amount')
    .eq('registration_id', registrationId);
  const paid = (rows || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const update = { amount_paid: paid };
  // Fully settled means the slot is confirmed; anything short of that is still
  // a payment in progress and must not read as verified.
  const owed = Number(reg.amount) || 0;
  if (owed > 0) update.status = paid >= owed ? 'payment_verified' : 'payment_submitted';
  await supabase.from('event_registrations').update(update).eq('id', registrationId);
  return { paid, owed, settled: owed > 0 && paid >= owed };
}

// GET ?eventId=..&actorId=..  -> every flexible-plan registration for an event,
//                                each with the payments recorded against it
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });

    const { data: regs, error } = await supabase
      .from('event_registrations')
      .select('id, attendee_name, church_name, attendee_mobile, amount, base_amount, amount_paid, addons, status, payment_plan, created_at')
      .eq('event_id', eventId)
      .eq('payment_plan', 'flexible')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const ids = (regs || []).map((r) => r.id);
    let payments = [];
    if (ids.length > 0) {
      const { data: pays } = await supabase
        .from('event_registration_payments')
        .select('*')
        .in('registration_id', ids)
        .order('paid_on', { ascending: true });
      payments = pays || [];
    }

    const data = (regs || []).map((r) => {
      const mine = payments.filter((p) => p.registration_id === r.id);
      const paid = mine.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      return { ...r, payments: mine, paid, balance: Math.max(0, (Number(r.amount) || 0) - paid) };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST { actorId, registrationId, amount, paidOn, method, reference, note }
//   -> record one installment
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const amount = Number(body.amount);
    if (!body.registrationId) return NextResponse.json({ success: false, message: 'registrationId required' }, { status: 400 });
    if (!(amount > 0)) return NextResponse.json({ success: false, message: 'Enter an amount greater than zero.' }, { status: 400 });

    const { data: reg } = await supabase
      .from('event_registrations')
      .select('id, attendee_name, amount, amount_paid')
      .eq('id', body.registrationId)
      .single();
    if (!reg) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });

    // Overpaying is almost always a typo, and refunding is a manual affair.
    const owed = Number(reg.amount) || 0;
    const already = Number(reg.amount_paid) || 0;
    if (owed > 0 && already + amount > owed) {
      return NextResponse.json({
        success: false,
        message: `That is more than the remaining balance of ₱${owed - already}.`,
      }, { status: 400 });
    }

    const { error } = await supabase.from('event_registration_payments').insert({
      registration_id: body.registrationId,
      amount,
      paid_on: body.paidOn || new Date().toISOString().slice(0, 10),
      method: body.method || null,
      reference: body.reference || null,
      note: body.note || null,
      recorded_by: actor.id,
      recorded_by_name: `${actor.firstname} ${actor.lastname}`.trim(),
    });
    if (error) throw error;

    const totals = await recomputePaid(body.registrationId);
    await logAudit(actor, 'event_installment_payment', body.registrationId,
      `Recorded ₱${amount} for ${reg.attendee_name} (${totals?.paid || amount} of ${owed})`);

    return NextResponse.json({
      success: true,
      ...totals,
      message: totals?.settled ? 'Payment recorded - fully paid.' : 'Payment recorded.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?id=..&actorId=..  -> remove a payment that was entered by mistake
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { data: pay } = await supabase
      .from('event_registration_payments')
      .select('id, registration_id, amount')
      .eq('id', id)
      .single();
    if (!pay) return NextResponse.json({ success: false, message: 'Payment not found' }, { status: 404 });

    const { error } = await supabase.from('event_registration_payments').delete().eq('id', id);
    if (error) throw error;

    await recomputePaid(pay.registration_id);
    await logAudit(actor, 'event_installment_delete', pay.registration_id, `Removed a ₱${pay.amount} payment`);
    return NextResponse.json({ success: true, message: 'Payment removed' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
