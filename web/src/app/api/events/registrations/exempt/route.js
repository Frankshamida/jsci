import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cacheInvalidate } from '@/lib/serverCache';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';
import { registrationFeeOf } from '@/lib/exemption';

// POST /api/events/registrations/exempt
//   { actorId, registrationId, note }            exempt them
//   { actorId, registrationId, restore: true }   take it back - they owe it again
//
// Somebody serving at the event (an usher, the worship team, the committee).
// The exemption is worth their registration fee and pays what they still owe,
// up to that - nothing already paid is given back (lib/exemption.js):
//   nothing paid yet           the fee is waived, accommodation still to pay
//   fee already paid (online)  their accommodation is free
// With nothing left to pay they are settled. What was waived and the status
// they had are kept, so taking it back puts it all back on them.
// See supabase/migrations/registration_exemption.sql.

export const dynamic = 'force-dynamic';

const PENDING_ALERTS_KEY = 'events:pending-registrations';
const MIGRATION_HINT = 'Exemptions need their migration: run supabase/migrations/registration_exemption.sql in the Supabase SQL editor, then try again.';
const OWING = ['pending_cash', 'pending_payment', 'installment'];
const PAID = ['payment_verified', 'registered', 'paid_pending_turnover'];
const clean = (v, n) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Admin';
const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;
const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

async function logAudit(actor, resourceId, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? nameOf(actor) : 'System',
      action: 'event_registration_exempt',
      resource: 'event_registration',
      resource_id: String(resourceId),
      details,
    });
  } catch { /* non-fatal */ }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await findEventActor(body.actorId);
    if (!isEventManager(actor)) return fail('Only an Admin or Super Admin can exempt an attendee.', 403);
    if (!body.registrationId) return fail('registrationId required');

    const { data: reg, error: readError } = await supabaseAdmin
      .from('event_registrations')
      .select('id, attendee_name, status, amount, amount_paid, addons, payment_plan, deleted_at, exempt_note, exempt_amount, exempt_cover, exempt_prev_status, exempted_at')
      .eq('id', body.registrationId)
      .maybeSingle();
    if (readError) {
      if (/exempt/i.test(readError.message || '')) return fail(MIGRATION_HINT, 500);
      throw readError;
    }
    if (!reg || reg.deleted_at) return fail('Registration not found.', 404);
    if (reg.status === 'cancelled') return fail('A cancelled registration cannot be exempted.');

    const amount = Number(reg.amount) || 0;
    const paid = Number(reg.amount_paid) || 0;
    const who = clean(reg.attendee_name, 120);
    const now = new Date().toISOString();
    let patch;
    let message;

    if (body.restore) {
      if (!reg.exempted_at) return fail('This attendee is not exempted.');
      const fee = Number(reg.exempt_amount) || 0;
      if (fee > 0 && reg.status === 'paid_pending_turnover') {
        return fail('Their payment is still pending turnover. Turn it over first, then take the exemption back.');
      }
      let status = reg.status;
      const money = {};
      // The extras it paid for cost what they cost again.
      const addons = Array.isArray(reg.addons) ? reg.addons : [];
      if (addons.some((a) => a && a.waived)) money.addons = addons.map((a) => { if (!a || !a.waived) return a; const { waived, ...rest } = a; return rest; });
      if (fee > 0 && reg.status === 'registered' && amount <= 0) {
        // Nothing paid since: back to the status they had.
        status = reg.exempt_prev_status && reg.exempt_prev_status !== 'registered' ? reg.exempt_prev_status : 'pending_cash';
      } else if (fee > 0 && PAID.includes(reg.status)) {
        // They paid what was left (their accommodation) since: that stays
        // paid, and the fee is owed on top of it.
        money.amount_paid = Math.max(paid, amount);
        status = reg.payment_plan === 'flexible' ? 'installment' : 'pending_cash';
      }
      patch = {
        ...money,
        amount: amount + fee,
        status,
        ...(status !== reg.status && OWING.includes(status) ? { verified_by: null, verified_at: null } : {}),
        exempt_note: null,
        exempt_amount: 0,
        exempt_cover: 0,
        exempt_prev_status: null,
        exempted_at: null,
        exempted_by: null,
        exempted_by_name: null,
      };
      message = fee > 0
        ? `Exemption taken back - ${who} owes the ${peso(fee)} it waived again`
        : `Exemption taken back for ${who}`;
    } else {
      const note = clean(body.note, 80);
      if (!note) return fail('Say what they serve as - e.g. Usher, Worship Team.');
      if (reg.exempted_at) return fail(`Already exempted${reg.exempt_note ? ` (${reg.exempt_note})` : ''}.`);
      if (reg.status === 'payment_submitted') {
        return fail('They have sent a payment that is still waiting to be checked. Verify or reject it first.');
      }
      // Worth the registration fee; it pays what is still owed, up to that.
      const cover = registrationFeeOf(reg);
      // A paid status is paid in full, whatever amount_paid says.
      const paidSoFar = PAID.includes(reg.status) ? amount : paid;
      const owed = Math.max(0, amount - paidSoFar);
      const waived = Math.min(cover, owed);
      const left = owed - waived;
      // What they paid went to the registration fee first, so what is still
      // owed is their extras: the part of the waiver past the fee's unpaid
      // part pays for those - the latest first - and is marked on each, so
      // cancelling one later refunds nothing that was never paid.
      const feeUnpaid = Math.max(0, cover - paidSoFar);
      let onExtras = Math.max(0, waived - feeUnpaid);
      const addons = (Array.isArray(reg.addons) ? reg.addons : []).slice();
      for (let i = addons.length - 1; i >= 0 && onExtras > 0; i -= 1) {
        const a = addons[i];
        if (!a || !(a.question || a.id)) continue;
        const w = Math.min(onExtras, Number(a.fee) || 0);
        if (w > 0) { addons[i] = { ...a, waived: w }; onExtras -= w; }
      }
      // Nothing left to pay - settled: Registered when they owe nothing at
      // all, paid when what they paid covers the rest.
      const settle = waived > 0 && left <= 0 && !PAID.includes(reg.status);
      patch = {
        amount: amount - waived,
        ...(addons.some((a, i) => a !== reg.addons[i]) ? { addons } : {}),
        ...(settle ? { status: amount - waived > 0 ? 'payment_verified' : 'registered', verified_by: actor.id, verified_at: now } : {}),
        exempt_note: note,
        exempt_cover: cover,
        exempt_amount: waived,
        exempt_prev_status: reg.status,
        exempted_at: now,
        exempted_by: actor.id,
        exempted_by_name: clean(body.actorName, 120) || nameOf(actor),
      };
      if (waived <= 0) {
        message = paidSoFar > 0
          ? `${who} exempted (${note}) - already paid, nothing to give back; accommodation added later is free`
          : `${who} exempted (${note})`;
      } else if (paidSoFar > 0) {
        message = `${who} exempted (${note}) - registration fee already paid, so ${peso(waived)} of accommodation is free${left > 0 ? ` (${peso(left)} still to pay)` : ''}`;
      } else {
        message = `${who} exempted (${note}) - ${peso(waived)} registration fee waived${left > 0 ? `, ${peso(left)} for accommodation still to pay` : ''}`;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('event_registrations').update(patch).eq('id', reg.id).select('*').single();
    if (error) {
      if (/exempt/i.test(error.message || '')) return fail(MIGRATION_HINT, 500);
      throw error;
    }

    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit(actor, reg.id, body.restore
      ? `Took back the exemption of ${reg.attendee_name}${reg.exempt_note ? ` (${reg.exempt_note})` : ''} - owes the P${Number(reg.exempt_amount) || 0} it waived again, status ${patch.status}`
      : `Exempted ${reg.attendee_name} as ${patch.exempt_note} - worth P${patch.exempt_cover}, P${patch.exempt_amount} waived, total now P${patch.amount} (was ${reg.status})`);

    return NextResponse.json({ success: true, data, message });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
