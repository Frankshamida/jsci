import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, canWorkEvent, staffDeniedMessage } from '@/lib/eventCommittee';

// The ID queue - see supabase/migrations/registration_id_queue.sql.
// Anybody who may work the event: the verifier's desk adds to it, the person
// at the ID box (/id-queue) works through it.
//
//   GET    ?actorId=..[&eventId=..]          open requests and today's found / claimed, oldest first
//   POST   { actorId, eventId, registrationId, by }          ask for an attendee's ID
//   PATCH  { actorId, id, action: 'found' | 'undo' | 'cancel', by }
//          { actorId, registrationIds, action: 'claimed' }   the attendees were verified

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/registration_id_queue.sql first.';
const COLUMNS = 'id, event_id, registration_id, attendee_name, requested_by, requested_at, found_at, found_by, claimed_at';
const fail = (error) => NextResponse.json(
  { success: false, message: /registration_id_queue/i.test(error?.message || '') ? MIGRATION_HINT : (error?.message || 'Something went wrong') },
  { status: 500 },
);
const clip = (v, n = 160) => (v === null || v === undefined ? null : String(v).slice(0, n));
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Staff';
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await findEventActor(searchParams.get('actorId'));
    const eventId = searchParams.get('eventId');
    if (!actor || !canWorkEvent(actor, eventId)) return NextResponse.json({ success: false, message: staffDeniedMessage(actor) }, { status: 403 });

    // Everything still open, plus what was settled in the last day (for Undo
    // and for the desk to show Found / Claimed).
    const since = new Date(Date.now() - DAY_MS).toISOString();
    let q = supabaseAdmin.from('registration_id_queue').select(COLUMNS)
      .or(`claimed_at.is.null,claimed_at.gte.${since}`)
      .order('requested_at', { ascending: true }).limit(1000);
    if (eventId) q = q.eq('event_id', eventId);
    const { data, error } = await q;
    if (error) return fail(error);
    const rows = (data || []).filter((r) => canWorkEvent(actor, r.event_id));

    // The event names, for a queue page serving more than one event.
    const ids = [...new Set(rows.map((r) => r.event_id))];
    let events = {};
    if (ids.length) {
      const { data: evs } = await supabaseAdmin.from('events').select('id, title').in('id', ids);
      events = Object.fromEntries((evs || []).map((e) => [e.id, e.title]));
    }
    return NextResponse.json({ success: true, data: rows, events, me: nameOf(actor) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { data: reg } = await supabaseAdmin.from('event_registrations')
      .select('id, event_id, attendee_name').eq('id', body.registrationId || '').maybeSingle();
    if (!reg) return NextResponse.json({ success: false, message: 'That registration could not be found.' }, { status: 404 });
    const actor = await findEventActor(body.actorId);
    if (!canWorkEvent(actor, reg.event_id)) return NextResponse.json({ success: false, message: staffDeniedMessage(actor) }, { status: 403 });

    // Already asked for: the same request, not a second place in the line.
    const { data: open, error: openErr } = await supabaseAdmin.from('registration_id_queue')
      .select(COLUMNS).eq('registration_id', reg.id).is('claimed_at', null).maybeSingle();
    if (openErr) return fail(openErr);
    if (open) return NextResponse.json({ success: true, data: open, already: true });

    const { data, error } = await supabaseAdmin.from('registration_id_queue').insert([{
      event_id: reg.event_id,
      registration_id: reg.id,
      attendee_name: reg.attendee_name,
      requested_by: clip(body.by) || nameOf(actor),
      created_by: actor.id,
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
    const actor = await findEventActor(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: staffDeniedMessage(actor) }, { status: 403 });

    if (body.action === 'claimed') {
      const ids = (Array.isArray(body.registrationIds) ? body.registrationIds : []).filter(Boolean).slice(0, 200);
      if (!ids.length) return NextResponse.json({ success: true, data: [] });
      const { data, error } = await supabaseAdmin.from('registration_id_queue')
        .update({ claimed_at: new Date().toISOString() })
        .in('registration_id', ids).is('claimed_at', null).select(COLUMNS);
      if (error) return fail(error);
      return NextResponse.json({ success: true, data: data || [] });
    }

    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const { data: row, error: rowErr } = await supabaseAdmin.from('registration_id_queue').select(COLUMNS).eq('id', body.id).maybeSingle();
    if (rowErr) return fail(rowErr);
    if (!row) return NextResponse.json({ success: false, message: 'That request is no longer in the queue.' }, { status: 404 });
    if (!canWorkEvent(actor, row.event_id)) return NextResponse.json({ success: false, message: staffDeniedMessage(actor) }, { status: 403 });
    if (row.claimed_at) return NextResponse.json({ success: false, message: `${row.attendee_name} has already claimed their ID.` }, { status: 409 });

    if (body.action === 'cancel') {
      if (row.found_at) return NextResponse.json({ success: false, message: `${row.attendee_name}'s ID was already found.` }, { status: 409 });
      const { error } = await supabaseAdmin.from('registration_id_queue').delete().eq('id', row.id).is('found_at', null);
      if (error) return fail(error);
      return NextResponse.json({ success: true, data: null });
    }

    if (body.action === 'found') {
      if (row.found_at) return NextResponse.json({ success: true, data: row, already: true });
      // First asked, first found: the oldest open request at this event goes first.
      const { data: first } = await supabaseAdmin.from('registration_id_queue')
        .select('id, attendee_name').eq('event_id', row.event_id).is('found_at', null).is('claimed_at', null)
        .order('requested_at', { ascending: true }).limit(1).maybeSingle();
      if (first && first.id !== row.id) {
        return NextResponse.json({ success: false, message: `Find ${first.attendee_name}'s ID first - they were asked for earlier.` }, { status: 409 });
      }
      const { data, error } = await supabaseAdmin.from('registration_id_queue')
        .update({ found_at: new Date().toISOString(), found_by: clip(body.by) || nameOf(actor) })
        .eq('id', row.id).select(COLUMNS).single();
      if (error) return fail(error);
      return NextResponse.json({ success: true, data });
    }

    if (body.action === 'undo') {
      // Back into the line in its old place - requested_at is untouched.
      const { data, error } = await supabaseAdmin.from('registration_id_queue')
        .update({ found_at: null, found_by: null })
        .eq('id', row.id).select(COLUMNS).single();
      if (error) return fail(error);
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
