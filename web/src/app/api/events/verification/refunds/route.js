import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, canWorkEvent, staffDeniedMessage } from '@/lib/eventCommittee';

// Refunds for extras cancelled after paying - see
// supabase/migrations/registration_refunds.sql. A refund is created by the
// registrations route (action 'cancel_addon'), in the same step that takes
// the extra off; this lists them and marks them sent.
//
//   GET    ?eventId=..&actorId=..                    newest first
//   PATCH  { actorId, id, verifier: { name } }       mark it sent

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/registration_refunds.sql first.';
const COLUMNS = 'id, event_id, registration_id, attendee_name, extra, amount, recipient_name, sent_to, account_number, reason, verifier_id, verifier_name, created_at, sent_at, sent_by_name';
const fail = (error) => NextResponse.json(
  { success: false, message: /registration_refunds/i.test(error?.message || '') ? MIGRATION_HINT : (error?.message || 'Something went wrong') },
  { status: 500 },
);
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Staff';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const actor = await findEventActor(searchParams.get('actorId'));
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    if (!canWorkEvent(actor, eventId)) return NextResponse.json({ success: false, message: staffDeniedMessage(actor) }, { status: 403 });
    const { data, error } = await supabaseAdmin.from('registration_refunds').select(COLUMNS)
      .eq('event_id', eventId).order('created_at', { ascending: false }).limit(1000);
    if (error) return fail(error);
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const actor = await findEventActor(body.actorId);
    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const { data: row, error: rowErr } = await supabaseAdmin.from('registration_refunds').select(COLUMNS).eq('id', body.id).maybeSingle();
    if (rowErr) return fail(rowErr);
    if (!row) return NextResponse.json({ success: false, message: 'That refund could not be found.' }, { status: 404 });
    if (!canWorkEvent(actor, row.event_id)) return NextResponse.json({ success: false, message: staffDeniedMessage(actor) }, { status: 403 });
    const { data, error } = await supabaseAdmin.from('registration_refunds')
      .update({ sent_at: new Date().toISOString(), sent_by_name: String(body.verifier?.name || nameOf(actor)).slice(0, 160) })
      .eq('id', row.id).is('sent_at', null).select(COLUMNS).maybeSingle();
    if (error) return fail(error);
    if (!data) return NextResponse.json({ success: false, message: 'That refund was already marked sent.' }, { status: 409 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}
