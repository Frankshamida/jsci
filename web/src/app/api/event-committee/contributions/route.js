import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

export const dynamic = 'force-dynamic';

// Committee contributions - the drives themselves.
//
// A drive is a title, a description, and the shares people hold in it. The
// shares and their payments live in ./payments; this route answers "what is
// being collected, and how far along is each one".
//
// Admins only, like the Team tab it sits beside. A committee member collecting
// from other committee members is a different job from being on the committee,
// and nothing in the portal grants it.

// Money is read back as numeric, which the Postgres driver hands over as a
// string to avoid float rounding. Every sum in this file goes through here so
// "1200.00" and 1200 cannot end up on different sides of a comparison.
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

// The tables arrive in supabase/migrations/committee_contributions.sql. Until
// it is run this route says so, rather than returning a Postgres error the
// person reading it cannot act on.
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

// Every share of every drive named, with its payments, rolled up per drive.
//
// Read in two queries rather than one per drive: a church running eight
// collections with forty people on each is 320 rows, which is one round trip,
// and the alternative is seventeen.
async function rollUp(contributionIds) {
  const empty = { payersBy: {}, totalsBy: {} };
  if (contributionIds.length === 0) return empty;

  const { data: payers, error: payersError } = await supabase
    .from('committee_contribution_payers')
    .select('*')
    .in('contribution_id', contributionIds)
    .order('created_at', { ascending: false });
  if (payersError) throw payersError;

  const payerIds = (payers || []).map((p) => p.id);
  let payments = [];
  if (payerIds.length > 0) {
    const { data: paymentRows, error: paymentsError } = await supabase
      .from('committee_contribution_payments')
      .select('*')
      .in('payer_id', payerIds)
      .order('paid_on', { ascending: true })
      .order('created_at', { ascending: true });
    if (paymentsError) throw paymentsError;
    payments = paymentRows || [];
  }

  // Who signs the receipt for each payment: whoever took the money, not
  // whoever happens to be printing it. Admin B opening a receipt for a payment
  // Admin A received must not put B's signature on A's transaction.
  //
  // Read once for the whole page rather than per payment - a drive with forty
  // instalments on it was taken by two or three people, not forty.
  const signers = {};
  const signerIds = [...new Set(payments.map((p) => p.recorded_by).filter(Boolean))];
  if (signerIds.length > 0) {
    try {
      const { data: rows } = await supabase
        .from('users').select('id, signature_url, signature_name').in('id', signerIds);
      (rows || []).forEach((row) => {
        if (row.signature_url) {
          signers[row.id] = { url: row.signature_url, name: row.signature_name || null };
        }
      });
    } catch {
      // The signature columns arrive in their own migration. Without them a
      // receipt prints with a blank line to sign by hand, which is what it did
      // before signatures existed - not a reason to fail the whole listing.
    }
  }

  const paymentsByPayer = {};
  payments.forEach((row) => {
    if (!paymentsByPayer[row.payer_id]) paymentsByPayer[row.payer_id] = [];
    const signer = signers[row.recorded_by];
    paymentsByPayer[row.payer_id].push({
      ...row,
      amount: money(row.amount),
      signature_url: signer?.url || null,
      // The name the signer chose to have printed under their mark, which is
      // not always the name their account is registered under.
      signature_name: signer?.name || row.recorded_by_name || null,
    });
  });

  const payersBy = {};
  const totalsBy = {};
  contributionIds.forEach((id) => {
    payersBy[id] = [];
    totalsBy[id] = { payers: 0, expected: 0, collected: 0, balance: 0, settled: 0 };
  });

  (payers || []).forEach((payer) => {
    const own = paymentsByPayer[payer.id] || [];
    const paid = money(own.reduce((sum, p) => sum + p.amount, 0));
    const due = money(payer.amount_due);
    // Never negative. Somebody who overpaid by a hundred pesos is settled, not
    // owed money by the drive - that is a refund, which is a conversation and
    // not a column.
    const balance = money(Math.max(0, due - paid));
    const row = { ...payer, amount_due: due, paid, balance, settled: balance <= 0, payments: own };

    payersBy[payer.contribution_id] = payersBy[payer.contribution_id] || [];
    payersBy[payer.contribution_id].push(row);

    const t = totalsBy[payer.contribution_id] || { payers: 0, expected: 0, collected: 0, balance: 0, settled: 0 };
    t.payers += 1;
    t.expected = money(t.expected + due);
    t.collected = money(t.collected + paid);
    t.balance = money(t.balance + balance);
    if (balance <= 0) t.settled += 1;
    totalsBy[payer.contribution_id] = t;
  });

  return { payersBy, totalsBy };
}

// GET ?actorId=..        -> every drive, each with its shares and totals
// GET ?actorId=..&id=..  -> one drive, same shape
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const id = searchParams.get('id');

    let query = supabase
      .from('committee_contributions')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (id) query = query.eq('id', id);

    const { data: drives, error } = await query;
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    const ids = (drives || []).map((d) => d.id);
    const { payersBy, totalsBy } = await rollUp(ids);

    const data = (drives || []).map((drive) => ({
      ...drive,
      payers: payersBy[drive.id] || [],
      totals: totalsBy[drive.id] || { payers: 0, expected: 0, collected: 0, balance: 0, settled: 0 },
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return migrationMissing(error.message)
      ? NEEDS_MIGRATION()
      : NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST { actorId, title, description } -> start a drive
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await requireManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const title = clean(body.title);
    if (!title) return NextResponse.json({ success: false, message: 'A title is required.' }, { status: 400 });

    const { data, error } = await supabase
      .from('committee_contributions')
      .insert({
        title,
        description: clean(body.description),
        is_active: body.isActive === undefined ? true : !!body.isActive,
        position: Number(body.position) || 0,
        created_by: actor.id,
        created_by_name: `${actor.firstname} ${actor.lastname}`.trim(),
      })
      .select('*')
      .single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    await logAudit(actor, 'committee_contribution_create', data.id, `Started the contribution "${title}"`);
    return NextResponse.json({
      success: true,
      data: { ...data, payers: [], totals: { payers: 0, expected: 0, collected: 0, balance: 0, settled: 0 } },
      message: `"${title}" created`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT { actorId, id, title?, description?, isActive? } -> edit a drive
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await requireManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const update = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) {
      const title = clean(body.title);
      if (!title) return NextResponse.json({ success: false, message: 'A title is required.' }, { status: 400 });
      update.title = title;
    }
    if (body.description !== undefined) update.description = clean(body.description);
    if (body.isActive !== undefined) update.is_active = !!body.isActive;

    const { data, error } = await supabase
      .from('committee_contributions').update(update).eq('id', body.id).select('*').single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ success: false, message: 'Contribution not found' }, { status: 404 });

    await logAudit(actor, 'committee_contribution_update', data.id, `Edited the contribution "${data.title}"`);
    return NextResponse.json({ success: true, data, message: 'Contribution updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?actorId=..&id=..        -> remove a drive nobody has paid into
//        &force=1                 -> remove it WITH the money on it
//
// The guard is the point: a drive with payments against it is somebody's
// receipt. Deleting it silently takes their record with it (the rows cascade),
// so it takes a second, deliberate press.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { data: drive } = await supabase
      .from('committee_contributions').select('id, title').eq('id', id).single();
    if (!drive) return NextResponse.json({ success: false, message: 'Contribution not found' }, { status: 404 });

    const { payersBy, totalsBy } = await rollUp([id]);
    const totals = totalsBy[id] || { payers: 0, collected: 0 };
    if (totals.collected > 0 && searchParams.get('force') !== '1') {
      return NextResponse.json({
        success: false,
        code: 'HAS_PAYMENTS',
        message: `"${drive.title}" already has ${totals.collected.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })} recorded against it from ${totals.payers} ${totals.payers === 1 ? 'person' : 'people'}. Deleting it removes those payment records too.`,
      }, { status: 409 });
    }

    const { error } = await supabase.from('committee_contributions').delete().eq('id', id);
    if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });

    await logAudit(actor, 'committee_contribution_delete', id,
      `Deleted the contribution "${drive.title}"${totals.collected > 0 ? ` along with ${(payersBy[id] || []).length} payment record(s)` : ''}`);
    return NextResponse.json({ success: true, message: `"${drive.title}" deleted` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
