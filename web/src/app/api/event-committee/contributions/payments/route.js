import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

export const dynamic = 'force-dynamic';

// Committee contributions - the shares, and the money against them.
//
// Two things are created here and they are deliberately one call apart:
//
//   a SHARE    "Maria is down for ₱2,000 on the Christmas drive, paying it
//              off in instalments" - POST without payerId
//   a PAYMENT  "Maria handed over ₱500 in cash on the 14th" - POST with
//              payerId
//
// Opening a share on the "paid in full" plan records the first payment in the
// same breath, because that is what paid in full MEANS - there is no state
// where somebody is down as settled with no money behind it. An instalment
// share may open with a first payment or with nothing at all, which is the
// difference between somebody who has started paying and somebody who has only
// been signed up.

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

function migrationMissing(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('committee_contribution')
    || (text.includes('relation') && text.includes('does not exist'));
}

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'Committee contributions are not in the database yet. Run supabase/migrations/committee_contributions.sql in the Supabase SQL editor.',
}, { status: 503 });

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action,
      resource: 'committee_contribution',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// A date the <input type="date"> produced, or today. Stored as a plain date
// rather than a timestamp: the question is which DAY the money came in, and a
// timestamp would drag the browser's timezone into the answer.
const asDate = (v) => {
  const raw = clean(v);
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
};

// What the money came through. A channel the church administers carries its id
// AND the name it had at the time; Cash carries only the name, because cash is
// not something anybody set up in Mode of Payment.
async function resolveMethod(methodId, methodName) {
  const name = clean(methodName);
  if (!methodId) return { method_id: null, method_name: name || 'Cash' };
  try {
    const { data } = await supabase
      .from('payment_methods').select('id, name').eq('id', methodId).single();
    if (data) return { method_id: data.id, method_name: data.name };
  } catch { /* a channel that has since been deleted keeps the name we were given */ }
  return { method_id: null, method_name: name || 'Cash' };
}

// One share with its payments and the arithmetic, for handing straight back to
// the screen that just changed it.
async function readPayer(payerId) {
  const { data: payer, error } = await supabase
    .from('committee_contribution_payers').select('*').eq('id', payerId).single();
  if (error || !payer) return null;

  const { data: payments } = await supabase
    .from('committee_contribution_payments')
    .select('*')
    .eq('payer_id', payerId)
    .order('paid_on', { ascending: true })
    .order('created_at', { ascending: true });

  const own = (payments || []).map((p) => ({ ...p, amount: money(p.amount) }));
  const paid = money(own.reduce((sum, p) => sum + p.amount, 0));
  const due = money(payer.amount_due);
  const balance = money(Math.max(0, due - paid));
  return { ...payer, amount_due: due, paid, balance, settled: balance <= 0, payments: own };
}

// POST - open a share, or record money against one.
//
// { actorId, contributionId, userId, amountDue, plan, ... }  -> new share
// { actorId, payerId, amount, paidOn, methodId, ... }        -> new payment
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await requireManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const actorName = `${actor.firstname} ${actor.lastname}`.trim();

    /* ---------- Money against a share that already exists ---------- */
    if (body.payerId) {
      const amount = money(body.amount);
      if (amount <= 0) return NextResponse.json({ success: false, message: 'Enter how much was received.' }, { status: 400 });

      const before = await readPayer(body.payerId);
      if (!before) return NextResponse.json({ success: false, message: 'That share is no longer there.' }, { status: 404 });

      const method = await resolveMethod(body.methodId, body.methodName);
      const { error } = await supabase.from('committee_contribution_payments').insert({
        payer_id: body.payerId,
        amount,
        paid_on: asDate(body.paidOn),
        ...method,
        reference: clean(body.reference),
        note: clean(body.note),
        recorded_by: actor.id,
        recorded_by_name: actorName,
      });
      if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

      const after = await readPayer(body.payerId);
      await logAudit(actor, 'committee_contribution_payment', body.payerId,
        `Recorded ₱${amount.toLocaleString('en-PH')} from ${before.payer_name || 'a member'} via ${method.method_name}`);

      return NextResponse.json({
        success: true,
        data: after,
        message: after.settled
          ? `₱${amount.toLocaleString('en-PH')} recorded — ${before.payer_name || 'this member'} is fully paid.`
          : `₱${amount.toLocaleString('en-PH')} recorded — ₱${after.balance.toLocaleString('en-PH')} still to collect.`,
      });
    }

    /* ---------- A new share of a drive ---------- */
    if (!body.contributionId) return NextResponse.json({ success: false, message: 'contributionId required' }, { status: 400 });
    if (!body.userId) return NextResponse.json({ success: false, message: 'Choose who is paying.' }, { status: 400 });

    const amountDue = money(body.amountDue);
    if (amountDue <= 0) return NextResponse.json({ success: false, message: 'Enter the amount to be paid.' }, { status: 400 });

    const plan = body.plan === 'installment' ? 'installment' : 'full';
    // Paid in full means the whole share, handed over now. Taking the amount
    // from the caller as well would let the two disagree, and a share marked
    // settled for less than it is worth is the one error nobody notices.
    const first = plan === 'full' ? amountDue : money(body.amount);

    if (plan === 'installment' && first > amountDue) {
      return NextResponse.json({
        success: false,
        message: `That first payment (₱${first.toLocaleString('en-PH')}) is more than the whole amount to pay (₱${amountDue.toLocaleString('en-PH')}).`,
      }, { status: 400 });
    }

    const { data: user } = await supabase
      .from('users').select('id, firstname, lastname, email').eq('id', body.userId).single();
    if (!user) return NextResponse.json({ success: false, message: 'That account no longer exists.' }, { status: 404 });

    const { data: payer, error: payerError } = await supabase
      .from('committee_contribution_payers')
      .insert({
        contribution_id: body.contributionId,
        user_id: user.id,
        payer_name: `${user.firstname || ''} ${user.lastname || ''}`.trim(),
        payer_email: user.email || null,
        amount_due: amountDue,
        plan,
        note: clean(body.note),
        created_by: actor.id,
      })
      .select('*')
      .single();

    if (payerError) {
      if (migrationMissing(payerError.message)) return NEEDS_MIGRATION();
      // The unique index doing its job: this person is already down for a
      // share of this drive. Said as the thing to do next, not as a constraint
      // name.
      if (String(payerError.message || '').toLowerCase().includes('duplicate')) {
        return NextResponse.json({
          success: false,
          code: 'ALREADY_ADDED',
          message: `${user.firstname} ${user.lastname} is already on this contribution. Add a payment to their existing share instead.`,
        }, { status: 409 });
      }
      return NextResponse.json({ success: false, message: payerError.message }, { status: 500 });
    }

    if (first > 0) {
      const method = await resolveMethod(body.methodId, body.methodName);
      const { error: paymentError } = await supabase.from('committee_contribution_payments').insert({
        payer_id: payer.id,
        amount: first,
        paid_on: asDate(body.paidOn),
        ...method,
        reference: clean(body.reference),
        note: clean(body.note),
        recorded_by: actor.id,
        recorded_by_name: actorName,
      });
      // The share is real even if the first payment failed to write - rolling
      // it back would lose the amount due as well, and the desk can retry the
      // payment on its own.
      if (paymentError && migrationMissing(paymentError.message)) return NEEDS_MIGRATION();
    }

    const data = await readPayer(payer.id);
    await logAudit(actor, 'committee_contribution_payer_add', payer.id,
      `${payer.payer_name} added to a contribution for ₱${amountDue.toLocaleString('en-PH')} (${plan === 'full' ? 'paid in full' : 'installment'})`);

    return NextResponse.json({
      success: true,
      data,
      message: plan === 'full'
        ? `${payer.payer_name} paid ₱${amountDue.toLocaleString('en-PH')} in full.`
        : `${payer.payer_name} added — ₱${data.balance.toLocaleString('en-PH')} to collect.`,
    });
  } catch (error) {
    return migrationMissing(error.message)
      ? NEEDS_MIGRATION()
      : NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT { actorId, payerId, amountDue?, plan?, note? } -> correct a share
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await requireManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!body.payerId) return NextResponse.json({ success: false, message: 'payerId required' }, { status: 400 });

    const update = { updated_at: new Date().toISOString() };
    if (body.amountDue !== undefined) {
      const amountDue = money(body.amountDue);
      if (amountDue <= 0) return NextResponse.json({ success: false, message: 'Enter the amount to be paid.' }, { status: 400 });
      update.amount_due = amountDue;
    }
    if (body.plan !== undefined) update.plan = body.plan === 'installment' ? 'installment' : 'full';
    if (body.note !== undefined) update.note = clean(body.note);

    const { error } = await supabase
      .from('committee_contribution_payers').update(update).eq('id', body.payerId);
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    const data = await readPayer(body.payerId);
    if (!data) return NextResponse.json({ success: false, message: 'That share is no longer there.' }, { status: 404 });

    await logAudit(actor, 'committee_contribution_payer_update', body.payerId,
      `Edited ${data.payer_name}'s share (₱${data.amount_due.toLocaleString('en-PH')}, ${data.plan})`);
    return NextResponse.json({ success: true, data, message: 'Share updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?actorId=..&paymentId=..  -> undo one payment, keeping the share
//        ?actorId=..&payerId=..    -> remove somebody from the drive entirely
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const paymentId = searchParams.get('paymentId');
    if (paymentId) {
      const { data: payment } = await supabase
        .from('committee_contribution_payments').select('id, payer_id, amount, method_name').eq('id', paymentId).single();
      if (!payment) return NextResponse.json({ success: false, message: 'That payment is no longer there.' }, { status: 404 });

      const { error } = await supabase.from('committee_contribution_payments').delete().eq('id', paymentId);
      if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });

      const data = await readPayer(payment.payer_id);
      await logAudit(actor, 'committee_contribution_payment_delete', payment.payer_id,
        `Removed a ₱${money(payment.amount).toLocaleString('en-PH')} payment from ${data?.payer_name || 'a share'}`);
      return NextResponse.json({ success: true, data, message: 'Payment removed' });
    }

    const payerId = searchParams.get('payerId');
    if (!payerId) return NextResponse.json({ success: false, message: 'payerId or paymentId required' }, { status: 400 });

    const before = await readPayer(payerId);
    if (!before) return NextResponse.json({ success: false, message: 'That share is no longer there.' }, { status: 404 });

    // Same guard as deleting a whole drive: money already handed over is
    // somebody's record, and the payments cascade away with the share.
    if (before.paid > 0 && searchParams.get('force') !== '1') {
      return NextResponse.json({
        success: false,
        code: 'HAS_PAYMENTS',
        message: `${before.payer_name} has already paid ₱${before.paid.toLocaleString('en-PH')} towards this. Removing them deletes those ${before.payments.length} payment record(s) as well.`,
      }, { status: 409 });
    }

    const { error } = await supabase.from('committee_contribution_payers').delete().eq('id', payerId);
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });

    await logAudit(actor, 'committee_contribution_payer_delete', payerId,
      `Removed ${before.payer_name} from a contribution`);
    return NextResponse.json({ success: true, message: `${before.payer_name} removed from this contribution` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
