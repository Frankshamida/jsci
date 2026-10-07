import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// The Registration Verification logs - see
// supabase/migrations/registration_verification_logs.sql. Admin / Super Admin.
//
//   GET    ?eventId=..&actorId=..               newest first
//   POST   { actorId, eventId, entries: [{ action, registrationId, attendeeName,
//            verifier: { id, name, duty }, details }] }
//   PATCH  { actorId, id, reason }              mark a payment, a substitute or
//                                               a desk verification reverted
//   PATCH  { actorId, eventId, registrationId, days, reason, byName }
//          every desk verification of one attendee on those days - the desk's
//          own Revert, which has no log id to hand
//
// The revert itself - putting the registration back to details.from, or
// taking the attendee off the check-in - is done first, through the routes
// with their own checks; this only records that it was done.

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/registration_verification_logs.sql first.';
const ACTIONS = ['session_start', 'session_end', 'card_tap', 'payment', 'substitute', 'added', 'verified',
  'extra_added', 'extra_removed', 'extra_cancelled', 'refund', 'refund_sent'];
const COLUMNS = 'id, event_id, registration_id, action, attendee_name, verifier_id, verifier_name, verifier_duty, actor_id, details, created_at, reverted_at, reverted_by, reverted_by_name, revert_reason';

const fail = (error) => NextResponse.json(
  { success: false, message: /registration_verification_logs/i.test(error?.message || '') ? MIGRATION_HINT : (error?.message || 'Something went wrong') },
  { status: 500 },
);
const clip = (v, n = 200) => (v === null || v === undefined ? null : String(v).slice(0, n));
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Admin';
const REVERTIBLE = ['payment', 'substitute', 'verified'];

async function manager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}
const denied = () => NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can see the verification logs.' }, { status: 403 });

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (!(await manager(searchParams.get('actorId')))) return denied();
    const eventId = searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('registration_verification_logs')
      .select(COLUMNS)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) return fail(error);
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await manager(body.actorId);
    if (!actor) return denied();
    if (!body.eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const rows = (Array.isArray(body.entries) ? body.entries : [])
      .filter((e) => e && ACTIONS.includes(e.action) && e.verifier?.name)
      .slice(0, 200)
      .map((e) => ({
        event_id: body.eventId,
        registration_id: e.registrationId || null,
        action: e.action,
        attendee_name: clip(e.attendeeName),
        verifier_id: clip(e.verifier.id, 80),
        verifier_name: clip(e.verifier.name),
        verifier_duty: clip(e.verifier.duty),
        actor_id: actor.id,
        details: e.details && typeof e.details === 'object' ? e.details : {},
      }));
    if (!rows.length) return NextResponse.json({ success: true, data: [] });
    const { data, error } = await supabaseAdmin.from('registration_verification_logs').insert(rows).select(COLUMNS);
    if (error) return fail(error);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const actor = await manager(body.actorId);
    if (!actor) return denied();
    // Who reverted it: the verifier on the desk when it was done from there,
    // otherwise the Admin signed in.
    const stamp = {
      reverted_at: new Date().toISOString(),
      reverted_by: actor.id,
      reverted_by_name: clip(String(body.byName || '').trim(), 120) || nameOf(actor),
      revert_reason: clip(body.reason, 300),
    };

    // From the desk: every Verified log of this attendee on those days.
    if (!body.id && body.registrationId) {
      if (!body.eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
      const days = (Array.isArray(body.days) ? body.days : []).map(Number).filter((d) => d > 0);
      const { data: open, error: openError } = await supabaseAdmin
        .from('registration_verification_logs')
        .select('id, details')
        .eq('event_id', body.eventId)
        .eq('registration_id', body.registrationId)
        .eq('action', 'verified')
        .is('reverted_at', null);
      if (openError) return fail(openError);
      const ids = (open || []).filter((l) => !days.length || days.includes(Number(l.details?.day))).map((l) => l.id);
      if (!ids.length) return NextResponse.json({ success: true, data: [] });
      const { data, error } = await supabaseAdmin
        .from('registration_verification_logs').update(stamp).in('id', ids).select(COLUMNS);
      if (error) return fail(error);
      return NextResponse.json({ success: true, data: data || [] });
    }

    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const { data: log, error: readError } = await supabaseAdmin
      .from('registration_verification_logs').select('id, action, reverted_at').eq('id', body.id).maybeSingle();
    if (readError) return fail(readError);
    if (!log) return NextResponse.json({ success: false, message: 'Log not found.' }, { status: 404 });
    if (!REVERTIBLE.includes(log.action)) return NextResponse.json({ success: false, message: 'Only a payment, a substitute or a verification can be reverted.' }, { status: 400 });
    if (log.reverted_at) return NextResponse.json({ success: false, message: 'This was already reverted.' }, { status: 409 });
    const { data, error } = await supabaseAdmin
      .from('registration_verification_logs')
      .update(stamp)
      .eq('id', body.id)
      .select(COLUMNS)
      .single();
    if (error) return fail(error);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}
