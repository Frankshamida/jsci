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

// ---- Changing a recorded payment ----
//
// A record can be corrected after the fact:
//
//   edit         who held the money (Cash On Hand), or where it was sent - the
//                bank, the recipient, the reference (Online Payment) - and the
//                notes. The registrations it paid carry the same names, so they
//                are changed with it where they still say what it said.
//   remove       an attendee taken off it: their payment is undone - back to the
//                status, method and reference they had before it (kept on the
//                record's items for exactly this) - and the record's total comes
//                down by what it took for them. The last one off deletes it.
//   delete       every attendee's payment undone, and the record gone.
//
// A payment is only undone while the registration still stands on it: paid,
// as this record left it. One that has moved on since (cancelled, paid again
// some other way) is reported and left alone.

const noteOf = (rec) => (rec.kind === 'cash'
  ? `Payments tab - cash on hand from ${rec.holder_name}`
  : `Payments tab - ${rec.bank_name} to ${rec.recipient_name}`);

async function loadRecord(id) {
  const { data, error } = await supabase.from(RECORDS_TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// Undo what `rec` did for one attendee (`item`, as it stood when it was
// recorded). Returns { ok: true, data } or { ok: false, why }.
async function unsettle(reg, item, rec) {
  const who = reg?.attendee_name || item.name || 'An attendee';
  if (!reg || reg.deleted_at) return { ok: true, data: null }; // nothing left to undo
  const amt = Number(item.amount) || 0;
  const bedFee = Number(item.bedFee) || 0;
  const bedBack = bedFee > 0 ? { bed_wait_paid: Math.max(0, (Number(reg.bed_wait_paid) || 0) - bedFee) } : {};

  if (reg.payment_plan === 'flexible') {
    // The installment this payment made goes, and the plan is worked out again.
    const { data: pays } = await supabase.from('event_registration_payments')
      .select('id, amount, note, created_at').eq('registration_id', reg.id).order('created_at', { ascending: false });
    const list = pays || [];
    const mine = list.find((p) => cents(p.amount) === cents(amt) && p.note === noteOf(rec))
      || list.find((p) => cents(p.amount) === cents(amt) && String(p.note || '').startsWith('Payments tab'));
    if (!mine) return { ok: false, why: `${who}: the installment this payment made is not on their plan any more.` };
    const { error: delErr } = await supabase.from('event_registration_payments').delete().eq('id', mine.id);
    if (delErr) throw delErr;
    const paid = list.filter((p) => p.id !== mine.id).reduce((t, p) => t + (Number(p.amount) || 0), 0);
    const settledNow = paid >= (Number(reg.amount) || 0) && paid > 0;
    const { data, error } = await supabase.from('event_registrations').update({
      amount_paid: paid,
      status: settledNow ? 'payment_verified' : 'installment',
      ...(settledNow ? {} : { verified_by: null, verified_at: null }),
      ...bedBack,
    }).eq('id', reg.id).select().single();
    if (error) throw error;
    return { ok: true, data };
  }

  // Only the bed they were waiting for was paid here.
  if (amt - bedFee <= 0) {
    if (!bedFee) return { ok: true, data: reg };
    const { data, error } = await supabase.from('event_registrations').update(bedBack).eq('id', reg.id).select().single();
    if (error) throw error;
    return { ok: true, data };
  }

  if (reg.status !== 'payment_verified') {
    return { ok: false, why: `${who} is ${String(reg.status || '').replace(/_/g, ' ')} now - no longer the payment this record made.` };
  }
  const back = item.from && !['payment_verified', 'registered', 'cancelled'].includes(item.from) ? item.from : 'pending_cash';
  const update = {
    status: back,
    verified_by: null,
    verified_at: null,
    payment_method: item.prevMethod ?? null,
    payment_reference: item.prevReference ?? null,
    ...bedBack,
  };
  // The receipt this record attached is not theirs any more.
  if (rec.proof_url && reg.payment_proof_url === rec.proof_url) update.payment_proof_url = null;
  const turnover = {
    turned_over_at: null,
    turned_over_by: null,
    turnover_holder: back === 'paid_pending_turnover' ? (item.prevHolder || null) : null,
  };
  let { data, error } = await supabase.from('event_registrations').update({ ...update, ...turnover }).eq('id', reg.id).select().single();
  if (error && /turnover|turned_over|column/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('event_registrations').update(update).eq('id', reg.id).select().single());
  }
  if (error) throw error;
  return { ok: true, data };
}

// Undo the payment for `ids` (every attendee when null). Returns what was
// undone, what could not be, and the record's items left.
async function undoItems(rec, ids) {
  const items = Array.isArray(rec.items) ? rec.items : [];
  const targets = items.filter((it) => !ids || ids.includes(String(it.id)));
  const { data: regs } = targets.length
    ? await supabase.from('event_registrations').select('*').in('id', targets.map((it) => it.id))
    : { data: [] };
  const byId = new Map((regs || []).map((r) => [String(r.id), r]));
  const undone = [];
  const refused = [];
  const updated = [];
  for (const it of targets) {
    const res = await unsettle(byId.get(String(it.id)), it, rec);
    if (res.ok) { undone.push(it); if (res.data) updated.push(res.data); } else refused.push(res.why);
  }
  const gone = new Set(undone.map((it) => String(it.id)));
  return { undone, refused, updated, left: items.filter((it) => !gone.has(String(it.id))) };
}

async function patchRecord(body, actor) {
  const rec = await loadRecord(clean(body.id, 64));
  if (!rec) return NextResponse.json({ success: false, message: 'That payment is no longer recorded.' }, { status: 404 });

  if (body.action === 'remove_items') {
    const ids = [...new Set((Array.isArray(body.registrationIds) ? body.registrationIds : []).map((x) => clean(x, 64)).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ success: false, message: 'Choose who to take off this payment.' }, { status: 400 });
    const { undone, refused, updated, left } = await undoItems(rec, ids);
    if (!undone.length) return NextResponse.json({ success: false, message: refused[0] || 'Nothing was changed.' }, { status: 409 });
    const took = undone.reduce((t, it) => t + (Number(it.amount) || 0), 0);
    let data = null;
    if (left.length === 0) {
      const { error } = await supabase.from(RECORDS_TABLE).delete().eq('id', rec.id);
      if (error) throw error;
    } else {
      const { data: saved, error } = await supabase.from(RECORDS_TABLE).update({
        items: left,
        registration_ids: left.map((it) => it.id),
        total_amount: Math.max(0.01, (Number(rec.total_amount) || 0) - took),
      }).eq('id', rec.id).select().single();
      if (error) throw error;
      data = saved;
    }
    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit(actor, 'event_payment_batch', rec.event_id,
      `Took ${undone.map((it) => it.name).join(', ')} off a ${rec.kind === 'cash' ? `cash on hand payment from ${rec.holder_name}` : `${rec.bank_name} payment ref ${rec.reference}`} - P${took} undone`
      + (left.length ? `, P${(Number(rec.total_amount) || 0) - took} left` : ', record deleted'));
    return NextResponse.json({
      success: true, data, deleted: left.length === 0, updated,
      warning: refused.join(' '),
      message: `${undone.length === 1 ? undone[0].name : `${undone.length} attendees`} taken off - ₱${took.toLocaleString('en-PH')} payment undone${left.length ? '' : ', and the record deleted'}.`,
    });
  }

  // edit: the names on it, and the notes.
  const patch = {};
  const regPatch = []; // [{ match: {col: old}, set: {col: new} }]
  if (body.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 2000) || null;
  if (rec.kind === 'cash' && body.holderName !== undefined) {
    const holder = clean(body.holderName, 120).replace(/^by\s+/i, '');
    if (!holder) return NextResponse.json({ success: false, message: 'Enter the name of the person holding the money.' }, { status: 400 });
    if (holder !== rec.holder_name) { patch.holder_name = holder; regPatch.push({ col: 'turnover_holder', from: rec.holder_name, to: holder }); }
  }
  if (rec.kind === 'online') {
    if (body.bankName !== undefined) {
      const bank = clean(body.bankName, 80);
      if (!bank) return NextResponse.json({ success: false, message: 'Enter the bank or e-wallet it was sent through.' }, { status: 400 });
      if (bank !== rec.bank_name) { patch.bank_name = bank; regPatch.push({ col: 'payment_method', from: rec.bank_name, to: bank }); }
    }
    if (body.recipientName !== undefined) {
      const recipient = clean(body.recipientName, 120);
      if (!recipient) return NextResponse.json({ success: false, message: 'Enter the name of the recipient.' }, { status: 400 });
      if (recipient !== rec.recipient_name) patch.recipient_name = recipient;
    }
    if (body.reference !== undefined) {
      const reference = clean(body.reference, 120);
      if (!reference) return NextResponse.json({ success: false, message: 'Enter the reference ID.' }, { status: 400 });
      if (reference !== rec.reference) { patch.reference = reference; regPatch.push({ col: 'payment_reference', from: rec.reference, to: reference }); }
    }
  }
  if (!Object.keys(patch).length) return NextResponse.json({ success: true, data: rec, message: 'Nothing to change.' });

  const { data, error } = await supabase.from(RECORDS_TABLE).update(patch).eq('id', rec.id).select().single();
  if (error) throw error;
  // The registrations it paid, where they still say what the record said.
  const ids = (Array.isArray(rec.items) ? rec.items : []).map((it) => it.id).filter(Boolean);
  for (const p of regPatch) {
    if (!ids.length || !p.from) continue;
    try {
      await supabase.from('event_registrations').update({ [p.col]: p.to })
        .in('id', ids).eq(p.col, p.from).eq('status', 'payment_verified');
    } catch { /* a column the database does not have yet */ }
  }
  // The installments it made carry the old names in their note.
  if (patch.holder_name || patch.bank_name || patch.recipient_name) {
    try {
      await supabase.from('event_registration_payments').update({ note: noteOf(data) })
        .in('registration_id', ids).eq('note', noteOf(rec));
    } catch { /* no plans on it */ }
  }
  await logAudit(actor, 'event_payment_batch', rec.event_id,
    `Edited a ${rec.kind === 'cash' ? 'cash on hand' : 'online'} payment of P${Number(rec.total_amount) || 0}: `
    + Object.entries(patch).map(([k, v]) => `${k} -> ${v ?? '(none)'}`).join(', '));
  return NextResponse.json({ success: true, data, message: 'Payment updated.' });
}

// DELETE ?id=..&actorId=..  -> every attendee's payment undone, and the record gone.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await superAdmin(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Only a Super Admin can delete a payment.' }, { status: 403 });
    const rec = await loadRecord(clean(searchParams.get('id'), 64));
    if (!rec) return NextResponse.json({ success: false, message: 'That payment is no longer recorded.' }, { status: 404 });

    const { undone, refused, updated, left } = await undoItems(rec, null);
    if (refused.length) {
      // Some could not be undone: they stay on the record, so it still says
      // what paid them; the rest come off.
      if (!undone.length) return NextResponse.json({ success: false, message: refused[0] }, { status: 409 });
      const took = undone.reduce((t, it) => t + (Number(it.amount) || 0), 0);
      await supabase.from(RECORDS_TABLE).update({
        items: left, registration_ids: left.map((it) => it.id),
        total_amount: Math.max(0.01, (Number(rec.total_amount) || 0) - took),
      }).eq('id', rec.id);
    } else {
      const { error } = await supabase.from(RECORDS_TABLE).delete().eq('id', rec.id);
      if (error) throw error;
    }
    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit(actor, 'event_payment_batch', rec.event_id,
      `Deleted a ${rec.kind === 'cash' ? `cash on hand payment from ${rec.holder_name}` : `${rec.bank_name} payment ref ${rec.reference}`} of P${Number(rec.total_amount) || 0}`
      + ` - undone for ${undone.map((it) => it.name).join(', ') || 'nobody'}`
      + (refused.length ? `; kept for ${left.map((it) => it.name).join(', ')}` : ''));
    return NextResponse.json({
      success: true, updated, deleted: !refused.length,
      warning: refused.join(' '),
      message: refused.length
        ? `${undone.length} payment${undone.length === 1 ? '' : 's'} undone - ${left.length} could not be, and ${left.length === 1 ? 'stays' : 'stay'} on the record.`
        : `Payment deleted - ${undone.length} attendee${undone.length === 1 ? '' : 's'} back to owing it.`,
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
// PATCH { actorId, id, action: 'edit' | 'remove_items', ... } - see above.
const MAX_RESOLVED_KEYS = 60;
export async function PATCH(request) {
  try {
    const body = await request.json();
    const actor = await superAdmin(body.actorId);
    if (body.action === 'edit' || body.action === 'remove_items') {
      if (!actor) return NextResponse.json({ success: false, message: 'Only a Super Admin can change a payment.' }, { status: 403 });
      return await patchRecord(body, actor);
    }
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
