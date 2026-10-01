import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// Change still to give back, from the verification desk - see
// supabase/migrations/registration_change_due.sql. Admin / Super Admin, as
// the desk runs on their dashboard.
//
//   GET    ?eventId=..&actorId=..        newest first
//   POST   { actorId, eventId, registrationIds, attendeeNames, amount,
//            cashReceived, totalDue, verifier: { id, name } }
//   PATCH  { actorId, id, verifier: { id, name } }     mark it given

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/registration_change_due.sql first.';
const COLUMNS = 'id, event_id, registration_ids, attendee_names, amount, cash_received, total_due, taken_by_id, taken_by_name, created_at, given_at, given_by_id, given_by_name';
const fail = (error) => NextResponse.json(
  { success: false, message: /registration_change_due/i.test(error?.message || '') ? MIGRATION_HINT : (error?.message || 'Something went wrong') },
  { status: 500 },
);
const clip = (v, n = 200) => (v === null || v === undefined ? null : String(v).slice(0, n));
const denied = () => NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can open the verification desk.' }, { status: 403 });

async function manager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (!(await manager(searchParams.get('actorId')))) return denied();
    const eventId = searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('registration_change_due').select(COLUMNS)
      .eq('event_id', eventId).order('created_at', { ascending: false }).limit(1000);
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
    const amount = Number(body.amount) || 0;
    if (!body.eventId || amount <= 0) return NextResponse.json({ success: false, message: 'eventId and an amount are required' }, { status: 400 });
    if (!body.verifier?.name) return NextResponse.json({ success: false, message: 'No verifier is signed in.' }, { status: 400 });
    const { data, error } = await supabaseAdmin.from('registration_change_due').insert([{
      event_id: body.eventId,
      registration_ids: (Array.isArray(body.registrationIds) ? body.registrationIds : []).filter(Boolean).slice(0, 200),
      attendee_names: clip(body.attendeeNames, 600) || '—',
      amount,
      cash_received: Number(body.cashReceived) || null,
      total_due: Number(body.totalDue) || null,
      taken_by_id: clip(body.verifier.id, 80),
      taken_by_name: clip(body.verifier.name),
      actor_id: actor.id,
    }]).select(COLUMNS).single();
    if (error) return fail(error);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!(await manager(body.actorId))) return denied();
    if (!body.id || !body.verifier?.name) return NextResponse.json({ success: false, message: 'id and the verifier are required' }, { status: 400 });
    const { data, error } = await supabaseAdmin.from('registration_change_due')
      .update({ given_at: new Date().toISOString(), given_by_id: clip(body.verifier.id, 80), given_by_name: clip(body.verifier.name) })
      .eq('id', body.id).is('given_at', null)
      .select(COLUMNS).maybeSingle();
    if (error) return fail(error);
    if (!data) return NextResponse.json({ success: false, message: 'That change was already given.' }, { status: 409 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}
