import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { cacheInvalidate } from '@/lib/serverCache';
import { findEventActor } from '@/lib/eventCommittee';
import { bedWaitCharge } from '@/lib/rooms';

export const dynamic = 'force-dynamic';

// ---- Payments tab ----
//
// One sum of money, and the attendees it pays for - recorded by a Super Admin
// from Event -> Payments:
//
//   Cash On Hand    somebody hands over the money they have been holding for a
//                   list of attendees (a pastor for their church, say).
//   Online Payment  one transfer - GCash, BPI, Maribank - that covers a list of
//                   attendees, with its recipient, reference and receipt.
//
// The total must equal what the chosen attendees still owe, worked out here
// from the database rather than trusted from the browser. Only then is anybody
// marked paid, so a batch is either the right money for the right people or
// nothing at all. See supabase/migrations/event_payment_records.sql.
//
// Somebody on the accommodation waiting list pays for the bed they are waiting
// for as well: its fee is part of what they owe here, and what is taken for it
// is kept in bed_wait_paid until the waiting list gives them the bed - which
// then adds it already paid for (promoteBedWaitlist, api/events/registrations).
//
// Money already sent online with the registration (a receipt waiting in Online
// Payment Verification) is never taken again here: that receipt is checked on
// the Verification view instead, so the same transfer is not recorded twice.

const PENDING_ALERTS_KEY = 'events:pending-registrations';
const RECORDS_TABLE = 'event_payment_records';
const MAX_ATTENDEES = 500;

// Already settled: nothing left to take for them.
const SETTLED = new Set(['payment_verified', 'registered', 'cancelled']);

const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Super Admin';
const cents = (n) => Math.round((Number(n) || 0) * 100);
// What one registration still owes - the same rule as the desk (regCashDue).
const owedOf = (r) => Math.max(0, (Number(r.amount) || 0) - (Number(r.amount_paid) || 0));
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
// The registration itself, if it is not paid yet.
const regDueOf = (r) => (SETTLED.has(r.status) ? 0 : owedOf(r));
// The bed they are waiting for, less anything already paid towards it.
const bedDueOf = (r, evt) => Math.max(0, bedWaitCharge(r, evt).fee - (Number(r.bed_wait_paid) || 0));

// The event's extras and age groups - what a waiting-list bed costs depends on
// both. Either table may predate its migration; a missing one is just empty.
async function loadPricing(eventId) {
  const [addons, tiers] = await Promise.all([
    supabase.from('event_addons').select('*').eq('event_id', eventId).then((r) => r.data || [], () => []),
    supabase.from('event_price_tiers').select('*').eq('event_id', eventId).order('position').then((r) => r.data || [], () => []),
  ]);
  return { event_addons: addons, event_price_tiers: tiers };
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? nameOf(actor) : 'System',
      action, resource: 'event_registration',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

async function superAdmin(actorId) {
  const actor = await findEventActor(actorId);
  return actor && actor.role === 'Super Admin' && actor.is_active !== false ? actor : null;
}

const missingTable = (error) => /event_payment_records|relation .* does not exist|schema cache/i.test(error?.message || '');
const MIGRATION_HINT = 'Payments need their table first: run supabase/migrations/event_payment_records.sql in the Supabase SQL editor, then try again.';

// GET ?eventId=..&actorId=..  -> every payment recorded for the event, newest first
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    if (!(await superAdmin(searchParams.get('actorId')))) {
      return NextResponse.json({ success: false, message: 'Only a Super Admin can see Payments.' }, { status: 403 });
    }
    const { data, error } = await supabase
      .from(RECORDS_TABLE)
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: true, data: [], needsMigration: true, message: MIGRATION_HINT });
      throw error;
    }
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// Mark one registration paid by this batch. A flexible plan is paid down
// through its payments, like the Flexible Installment tab does it, so its
// amount_paid can never drift from the rows behind it; everything else moves
// straight to Paid, like Collect Cash at the desk.
//
// regDue is the registration's own balance (0 when it is already paid and only
// the waiting-list bed is being paid for); bedDue is that bed.
async function settle(reg, { actor, kind, method, reference, proofUrl, holder, note, now }, { regDue, bedDue }) {
  const bedPaid = bedDue > 0 ? { bed_wait_paid: (Number(reg.bed_wait_paid) || 0) + bedDue } : {};
  if (reg.payment_plan === 'flexible') {
    // One payment for both: the plan's amount_paid then already holds the bed
    // money, and when the bed is given its fee is simply covered.
    const { error: payErr } = await supabase.from('event_registration_payments').insert({
      registration_id: reg.id,
      amount: regDue + bedDue,
      paid_on: now.slice(0, 10),
      method,
      reference: reference || null,
      note,
      recorded_by: actor.id,
      recorded_by_name: nameOf(actor),
    });
    if (payErr) throw payErr;
    const { data: rows } = await supabase.from('event_registration_payments').select('amount').eq('registration_id', reg.id);
    const paid = (rows || []).reduce((t, p) => t + (Number(p.amount) || 0), 0);
    const settled = paid >= (Number(reg.amount) || 0);
    const { data, error } = await supabase.from('event_registrations')
      .update({
        amount_paid: paid,
        status: settled ? 'payment_verified' : 'installment',
        verified_by: settled ? actor.id : null,
        verified_at: settled ? now : null,
        ...bedPaid,
      })
      .eq('id', reg.id).select().single();
    if (error) throw error;
    return data;
  }

  // Already paid, and only the waiting-list bed is being paid for: the
  // registration keeps the status and the payment it already has.
  if (regDue <= 0) {
    const { data, error } = await supabase.from('event_registrations').update(bedPaid).eq('id', reg.id).select().single();
    if (error) throw error;
    return data;
  }

  const update = {
    status: 'payment_verified',
    verified_by: actor.id,
    verified_at: now,
    payment_method: method,
    payment_reference: reference || null,
    ...bedPaid,
  };
  if (proofUrl) update.payment_proof_url = proofUrl;
  // Who had the money, kept the way a received turnover keeps it: the row
  // then reads "Turned over by <holder>" in the Registrations table. An
  // online transfer that settles money somebody was holding is the same
  // hand-over, so it is stamped too, and keeps the holder it already had.
  const turnover = {};
  if (kind === 'cash') {
    turnover.turnover_holder = holder;
    turnover.turned_over_at = now;
    turnover.turned_over_by = actor.id;
  } else if (reg.status === 'paid_pending_turnover') {
    turnover.turned_over_at = now;
    turnover.turned_over_by = actor.id;
  }
  let { data, error } = await supabase.from('event_registrations')
    .update({ ...update, ...turnover }).eq('id', reg.id).select().single();
  // A database without paid_pending_turnover.sql still takes the payment.
  if (error && Object.keys(turnover).length && /turnover|turned_over|column/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('event_registrations').update(update).eq('id', reg.id).select().single());
  }
  if (error) throw error;
  return data;
}

// POST multipart/form-data (or JSON):
//   eventId, actorId, kind ('cash' | 'online'), totalAmount, notes,
//   registrationIds (JSON array),
//   cash:   holderName
//   online: bankName, paymentMethodId, recipientName, reference, proof (file)
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let fields = {};
    let proofFile = null;
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) { if (k !== 'proof') fields[k] = v; }
      const file = form.get('proof');
      if (file && typeof file === 'object' && file.size > 0) proofFile = file;
    } else {
      fields = await request.json();
    }

    const actor = await superAdmin(fields.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Only a Super Admin can record payments here.' }, { status: 403 });

    const eventId = clean(fields.eventId, 64);
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const kind = fields.kind === 'online' ? 'online' : fields.kind === 'cash' ? 'cash' : '';
    if (!kind) return NextResponse.json({ success: false, message: 'Choose Cash On Hand or Online Payment.' }, { status: 400 });

    const holder = clean(fields.holderName, 120).replace(/^by\s+/i, '');
    const bankName = clean(fields.bankName, 80);
    const recipient = clean(fields.recipientName, 120);
    const reference = clean(fields.reference, 120);
    const notes = String(fields.notes || '').trim().slice(0, 2000);
    const total = Number(fields.totalAmount);
    if (!(total > 0)) return NextResponse.json({ success: false, message: 'Enter the total amount.' }, { status: 400 });

    if (kind === 'cash' && !holder) {
      return NextResponse.json({ success: false, message: 'Enter the name of the person holding the money.' }, { status: 400 });
    }
    if (kind === 'online') {
      if (!bankName) return NextResponse.json({ success: false, message: 'Choose the bank or e-wallet it was sent through.' }, { status: 400 });
      if (!recipient) return NextResponse.json({ success: false, message: 'Enter the name of the recipient.' }, { status: 400 });
      if (!reference) return NextResponse.json({ success: false, message: 'Enter the reference ID.' }, { status: 400 });
      if (!proofFile) return NextResponse.json({ success: false, message: 'Attach the proof of payment.' }, { status: 400 });
    }

    let ids = fields.registrationIds;
    if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = ids.split(','); } }
    ids = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter(Boolean))];
    if (ids.length === 0) return NextResponse.json({ success: false, message: 'Add at least one attendee.' }, { status: 400 });
    if (ids.length > MAX_ATTENDEES) return NextResponse.json({ success: false, message: `At most ${MAX_ATTENDEES} attendees in one payment.` }, { status: 400 });

    // The record is the point of this screen, so its table must be there
    // before anybody is marked paid - never registrations paid with no trace
    // of the money that paid them.
    const probe = await supabase.from(RECORDS_TABLE).select('id').limit(1);
    if (probe.error) {
      if (missingTable(probe.error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw probe.error;
    }

    const { data: regs, error: regErr } = await supabase
      .from('event_registrations').select('*').eq('event_id', eventId).in('id', ids);
    if (regErr) throw regErr;
    const byId = new Map((regs || []).map((r) => [String(r.id), r]));
    // Only needed when somebody is waiting for a bed.
    const pricing = (regs || []).some((r) => r.bed_wait_since) ? await loadPricing(eventId) : null;
    const bedDue = (r) => (pricing ? bedDueOf(r, pricing) : 0);

    // Already paid online with the registration, the receipt still waiting in
    // Online Payment Verification: the attendee's own, or - for a booking paid
    // on one transfer - a group-mate's that covers them too, the same rows the
    // Verification card lists.
    const groupRefs = [...new Set((regs || [])
      .filter((r) => r.status === 'pending_payment' && r.group_ref).map((r) => r.group_ref))];
    let sentRefs = new Set();
    if (groupRefs.length) {
      const { data: mates } = await supabase.from('event_registrations')
        .select('group_ref').eq('event_id', eventId).eq('status', 'payment_submitted')
        .in('group_ref', groupRefs).is('deleted_at', null);
      sentRefs = new Set((mates || []).map((m) => m.group_ref));
    }
    const sentOnline = (r) => r.status === 'payment_submitted'
      || (r.status === 'pending_payment' && !!r.group_ref && sentRefs.has(r.group_ref));
    // Their own balance, unless that money is already on its way online.
    const regDue = (r) => (sentOnline(r) ? 0 : regDueOf(r));

    // Every attendee checked before anything is written.
    const problems = [];
    const chosen = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r || r.deleted_at) { problems.push('One of the attendees is no longer on this event.'); continue; }
      const who = r.attendee_name || 'An attendee';
      if (r.status === 'cancelled') problems.push(`${who}'s registration is cancelled.`);
      else if (sentOnline(r) && bedDue(r) <= 0) problems.push(`${who} already paid online when they registered - verify it in Online Payment Verification instead of recording it again.`);
      else if (regDue(r) + bedDue(r) <= 0) problems.push(`${who} has nothing left to pay.`);
      else chosen.push(r);
    }
    if (problems.length) {
      return NextResponse.json({
        success: false,
        message: `${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''} Refresh the list and try again.`,
      }, { status: 409 });
    }

    const due = chosen.reduce((t, r) => t + regDue(r) + bedDue(r), 0);
    if (cents(due) !== cents(total)) {
      const diff = (cents(total) - cents(due)) / 100;
      return NextResponse.json({
        success: false,
        message: `The total does not match: the attendees owe ₱${due.toLocaleString('en-PH')} but ₱${total.toLocaleString('en-PH')} was entered (${diff > 0 ? 'over' : 'short'} by ₱${Math.abs(diff).toLocaleString('en-PH')}).`,
      }, { status: 400 });
    }

    // The bed money is kept in bed_wait_paid - which has to exist before anyone
    // is charged for a bed, or the money would be taken and forgotten.
    if (chosen.some((r) => bedDue(r) > 0)) {
      const { error: colErr } = await supabase.from('event_registrations').select('bed_wait_paid').limit(1);
      if (colErr) {
        return NextResponse.json({
          success: false,
          message: 'Paying for a bed on the waiting list needs the latest Payments migration: run supabase/migrations/event_payment_records.sql again, then try again.',
        }, { status: 500 });
      }
    }

    // The receipt goes up only once everything else has passed, so a refused
    // payment never leaves a stray file behind.
    let proofUrl = null;
    if (kind === 'online' && proofFile) {
      const uploaded = await uploadBufferToCloudinary(await proofFile.arrayBuffer(), {
        fileName: proofFile.name || 'payment-proof',
        mimeType: proofFile.type || 'application/octet-stream',
        folder: 'JSCI-System/event-payments',
        resourceType: 'auto',
      });
      proofUrl = uploaded.secureUrl;
    }

    const now = new Date().toISOString();
    const method = kind === 'cash' ? 'Cash' : bankName;
    const note = kind === 'cash'
      ? `Payments tab - cash on hand from ${holder}`
      : `Payments tab - ${bankName} to ${recipient}`;
    const ctx = { actor, kind, method, reference: kind === 'online' ? reference : '', proofUrl, holder, note, now };

    const updated = [];
    const items = [];
    const failed = [];
    for (const r of chosen) {
      const dues = { regDue: regDue(r), bedDue: bedDue(r) };
      try {
        const saved = await settle(r, ctx, dues);
        updated.push(saved);
        // As the registration stood before this payment, so the Registrations
        // table can later say where the two disagree (src/lib/paymentReview.js):
        // its total, and who was holding the money / what it claimed to be.
        items.push({
          id: r.id,
          name: r.attendee_name || '',
          church: r.church_name || '',
          amount: dues.regDue + dues.bedDue,
          total: Number(r.amount) || 0,
          // Of that, the bed they are still waiting for.
          bedFee: dues.bedDue,
          from: r.status,
          prevHolder: r.status === 'paid_pending_turnover' ? (r.turnover_holder || null) : null,
          prevMethod: r.payment_method || null,
          prevReference: r.payment_reference || null,
        });
      } catch (e) {
        failed.push({ name: r.attendee_name || r.id, error: e.message });
      }
    }
    if (updated.length === 0) {
      return NextResponse.json({ success: false, message: `Nothing was saved: ${failed[0]?.error || 'unknown error'}` }, { status: 500 });
    }

    const record = {
      event_id: eventId,
      kind,
      holder_name: kind === 'cash' ? holder : null,
      bank_name: kind === 'online' ? bankName : null,
      payment_method_id: kind === 'online' ? (clean(fields.paymentMethodId, 64) || null) : null,
      recipient_name: kind === 'online' ? recipient : null,
      reference: kind === 'online' ? reference : null,
      proof_url: proofUrl,
      total_amount: total,
      registration_ids: items.map((i) => i.id),
      items,
      notes: notes || null,
      recorded_by: actor.id,
      recorded_by_name: nameOf(actor),
    };
    const { data: saved, error: recErr } = await supabase.from(RECORDS_TABLE).insert(record).select().single();

    cacheInvalidate(PENDING_ALERTS_KEY);
    const peso = `P${total.toLocaleString('en-PH')}`;
    await logAudit(actor, 'event_payment_batch', eventId,
      (kind === 'cash' ? `Cash on hand ${peso} from ${holder}` : `Online payment ${peso} via ${bankName} to ${recipient}, ref ${reference}`)
      + ` for ${items.length} attendee${items.length === 1 ? '' : 's'}: ${items.map((i) => i.name).join(', ')}`
      + (failed.length ? ` - NOT saved for: ${failed.map((f) => f.name).join(', ')}` : ''));

    const warnings = [];
    if (failed.length) warnings.push(`Could not mark paid: ${failed.map((f) => f.name).join(', ')}.`);
    if (recErr) warnings.push(`The attendees were marked paid, but the payment record was not saved (${recErr.message}).`);

    return NextResponse.json({
      success: true,
      data: saved || null,
      updated,
      warning: warnings.join(' '),
      message: `₱${total.toLocaleString('en-PH')} recorded - ${items.length} attendee${items.length === 1 ? '' : 's'} marked paid.`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PATCH { actorId, registrationId, keys: string[], reasons: string[] }
//   Review Payment, resolved: the registration is right as it is now. Nothing
//   about it or the payment changes - the flags that were raised (their keys,
//   from src/lib/paymentReview.js) are kept on the registration so they are
//   not raised again. A key holds the values it was raised over, so anything
//   that changes after this is flagged afresh.
const MAX_RESOLVED_KEYS = 60;
export async function PATCH(request) {
  try {
    const body = await request.json();
    const actor = await superAdmin(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Only a Super Admin can resolve a payment review.' }, { status: 403 });

    const id = clean(body.registrationId, 64);
    if (!id) return NextResponse.json({ success: false, message: 'registrationId required' }, { status: 400 });
    const keys = [...new Set((Array.isArray(body.keys) ? body.keys : [])
      .map((k) => clean(k, 300)).filter(Boolean))].slice(0, MAX_RESOLVED_KEYS);
    if (keys.length === 0) return NextResponse.json({ success: false, message: 'Nothing to resolve.' }, { status: 400 });
    const reasons = (Array.isArray(body.reasons) ? body.reasons : []).map((r) => clean(r, 400)).filter(Boolean).slice(0, 20);

    const { data: reg, error: regErr } = await supabase
      .from('event_registrations').select('id, attendee_name, payment_review_resolved').eq('id', id).single();
    if (regErr) {
      if (/payment_review_resolved|column/i.test(regErr.message || '')) {
        return NextResponse.json({ success: false, message: 'Resolving a review needs the latest Payments migration: run supabase/migrations/event_payment_records.sql again, then try again.' }, { status: 500 });
      }
      if (regErr.code === 'PGRST116') return NextResponse.json({ success: false, message: 'That registration is no longer on this event.' }, { status: 404 });
      throw regErr;
    }

    // Added to what was resolved before, newest kept when it runs long.
    const before = Array.isArray(reg.payment_review_resolved?.keys) ? reg.payment_review_resolved.keys : [];
    const resolved = {
      keys: [...new Set([...before, ...keys])].slice(-MAX_RESOLVED_KEYS),
      at: new Date().toISOString(),
      by: actor.id,
      by_name: nameOf(actor),
    };
    const { data, error } = await supabase.from('event_registrations')
      .update({ payment_review_resolved: resolved }).eq('id', id).select('id, payment_review_resolved').single();
    if (error) throw error;

    await logAudit(actor, 'event_payment_review_resolved', id,
      `Resolved Review Payment for ${reg.attendee_name || 'an attendee'} - kept as it is${reasons.length ? `: ${reasons.join(' / ')}` : ''}`);

    return NextResponse.json({ success: true, data, message: 'Payment review resolved.' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
