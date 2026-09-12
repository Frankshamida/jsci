import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { roomEntitlement } from '@/lib/rooms';

// Who is sleeping in which room.
//
// See supabase/migrations/event_room_guests.sql for the shape. Two rules are
// enforced here rather than in the database, because both need explaining at
// the desk and a constraint violation explains nothing:
//
//   entitlement  a room goes to somebody who PAID for accommodation - a paid
//                extra on their registration. lib/rooms.js decides which
//                extra that is; the refusal names what they did avail.
//   capacity     a room's pax is its limit. "308 is full - 4 of 4" is a
//                sentence somebody can act on.
//
// The rule that must never break - one bed each - is the database's, on
// unique (event_id, registration_id). Moving somebody is an upsert onto that
// constraint, so two people assigning the same family at once cannot produce
// two rooms.

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, firstname, lastname, role')
      .eq('id', actorId)
      .single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

// The two failures worth naming by hand: a migration that has not been run
// says nothing useful as "relation does not exist", and it is the first thing
// anybody hits.
const explain = (error) => {
  const msg = error?.message || '';
  if (/event_room_guests/i.test(msg)) {
    return 'Room assignment needs its migration: run supabase/migrations/event_room_guests.sql in the Supabase SQL editor, then try again.';
  }
  if (/event_rooms/i.test(msg)) {
    return 'Accommodation needs its migration: run supabase/migrations/event_rooms.sql in the Supabase SQL editor, then try again.';
  }
  return msg || 'Something went wrong';
};

const GUEST_FIELDS = 'id, room_id, registration_id, event_id, assigned_at, assigned_by, notes';
// Enough of the registration to show a name at the desk and to judge whether
// somebody is entitled to the bed. addons is the snapshot of the extras they
// ticked - see event_addons.sql.
const REG_FIELDS = 'id, event_id, attendee_name, attendee_mobile, church_name, status, addons, deleted_at';

// GET /api/events/room-guests?eventId=..
//   Everybody housed at this event, with the name and the extras of each. One
//   request: the screen needs occupancy for every room at once, and asking
//   per room would be a request per room number.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('event_room_guests')
      .select(`${GUEST_FIELDS}, registration:event_registrations (${REG_FIELDS})`)
      .eq('event_id', eventId)
      .order('assigned_at', { ascending: true });
    if (error) throw error;

    // A registration that was moved to the Recycle Bin keeps its row here
    // through the foreign key, but it is not a person needing a bed any more -
    // and leaving it in would hold a place in a room against a name the rest
    // of the system has stopped showing.
    const rows = (data || []).filter((g) => g.registration && !g.registration.deleted_at
      && g.registration.status !== 'cancelled');

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// POST /api/events/room-guests
//   { eventId, roomId, registrationId, actorId, notes }
//
//   Put one person in one room. Called from the desk after a card has been
//   read - the card is resolved to a registration by
//   /api/rfid/event-checkin?uid=.. , which is the same lookup the kit and meal
//   counters use, so a card that works at one desk works at all of them.
//
//   Somebody already housed is MOVED here rather than refused: the commonest
//   correction at a hotel desk is "that family is in the wrong room", and
//   making it a two-step remove-then-add is how one of the two steps gets
//   forgotten.
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }

    const { eventId, roomId, registrationId } = body;
    const notes = String(body.notes || '').trim().slice(0, 300) || null;
    if (!eventId || !roomId || !registrationId) {
      return NextResponse.json({ success: false, message: 'eventId, roomId and registrationId are required' }, { status: 400 });
    }

    // ---- The room ----
    const { data: room, error: roomErr } = await supabaseAdmin
      .from('event_rooms')
      .select('id, event_id, room_type, room_number, pax')
      .eq('id', roomId)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) {
      return NextResponse.json({ success: false, message: 'That room could not be found' }, { status: 404 });
    }
    if (room.event_id !== eventId) {
      return NextResponse.json({ success: false, message: 'That room belongs to a different event' }, { status: 400 });
    }

    // ---- The person ----
    const { data: reg, error: regErr } = await supabaseAdmin
      .from('event_registrations')
      .select(REG_FIELDS)
      .eq('id', registrationId)
      .maybeSingle();
    if (regErr) throw regErr;
    if (!reg || reg.deleted_at) {
      return NextResponse.json({ success: false, message: 'That registration could not be found' }, { status: 404 });
    }
    if (reg.event_id !== eventId) {
      return NextResponse.json({ success: false, message: `${reg.attendee_name} is registered for a different event` }, { status: 400 });
    }
    if (reg.status === 'cancelled') {
      return NextResponse.json({ success: false, message: `${reg.attendee_name} cancelled their registration` }, { status: 400 });
    }

    // ---- Did they pay for a bed? ----
    // The refusal this whole desk exists for. Checked against the event's own
    // extras, and worded with what they DID avail so nobody has to go looking.
    const { data: addons } = await supabaseAdmin
      .from('event_addons')
      .select('id, question, fee')
      .eq('event_id', eventId);

    const entitled = roomEntitlement(reg.addons, addons);
    if (!entitled.ok) {
      return NextResponse.json({
        success: false,
        result: 'not_entitled',
        registration: reg,
        message: `${reg.attendee_name} ${entitled.why}. Only attendees who availed accommodation can be given a room.`,
      }, { status: 400 });
    }

    // ---- Is there space? ----
    // Their own row does not count against the room they are already in, so
    // re-scanning somebody who is already there is a no-op rather than a
    // "full" refusal on the last bed.
    const { data: inRoom, error: inErr } = await supabaseAdmin
      .from('event_room_guests')
      .select('id, registration_id')
      .eq('room_id', roomId);
    if (inErr) throw inErr;

    const already = (inRoom || []).find((g) => g.registration_id === registrationId);
    if (already) {
      return NextResponse.json({
        success: true,
        result: 'already_here',
        registration: reg,
        room,
        message: `${reg.attendee_name} is already in ${room.room_number}`,
      });
    }

    const taken = (inRoom || []).length;
    if (taken >= (Number(room.pax) || 1)) {
      return NextResponse.json({
        success: false,
        result: 'full',
        registration: reg,
        room,
        message: `${room.room_type} ${room.room_number} is full — ${taken} of ${room.pax} pax. Use another room, or raise its pax under Accommodation.`,
      }, { status: 409 });
    }

    // Where they were before, so the desk can say "moved from 308" rather
    // than silently changing it.
    const { data: prior } = await supabaseAdmin
      .from('event_room_guests')
      .select('id, room_id, room:event_rooms (room_number, room_type)')
      .eq('event_id', eventId)
      .eq('registration_id', registrationId)
      .maybeSingle();

    // Upsert onto (event_id, registration_id): one bed each, and a move is
    // the same write as a first assignment.
    const { data, error } = await supabaseAdmin
      .from('event_room_guests')
      .upsert([{
        room_id: roomId,
        registration_id: registrationId,
        event_id: eventId,
        assigned_by: actor.id,
        assigned_at: new Date().toISOString(),
        notes,
      }], { onConflict: 'event_id,registration_id', ignoreDuplicates: false })
      .select(`${GUEST_FIELDS}, registration:event_registrations (${REG_FIELDS})`)
      .single();
    if (error) throw error;

    const from = prior?.room?.room_number;
    return NextResponse.json({
      success: true,
      result: from ? 'moved' : 'assigned',
      data,
      room,
      registration: reg,
      message: from
        ? `${reg.attendee_name} moved from ${from} to ${room.room_number}`
        : `${reg.attendee_name} assigned to ${room.room_type} ${room.room_number}`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// PATCH /api/events/room-guests  { id, actorId, roomId, notes }
//   Correcting one assignment: moved to another room, or a note changed.
//   Room moves go through the same capacity check as a fresh assignment.
export async function PATCH(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }
    if (!body.id) {
      return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    }

    const { data: guest, error: gErr } = await supabaseAdmin
      .from('event_room_guests')
      .select(`${GUEST_FIELDS}, registration:event_registrations (${REG_FIELDS})`)
      .eq('id', body.id)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!guest) {
      return NextResponse.json({ success: false, message: 'That assignment could not be found' }, { status: 404 });
    }

    const patch = {};
    if (body.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 300) || null;

    if (body.roomId && body.roomId !== guest.room_id) {
      const { data: room } = await supabaseAdmin
        .from('event_rooms')
        .select('id, event_id, room_type, room_number, pax')
        .eq('id', body.roomId)
        .maybeSingle();
      if (!room) {
        return NextResponse.json({ success: false, message: 'That room could not be found' }, { status: 404 });
      }
      if (room.event_id !== guest.event_id) {
        return NextResponse.json({ success: false, message: 'That room belongs to a different event' }, { status: 400 });
      }
      const { count } = await supabaseAdmin
        .from('event_room_guests')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', body.roomId);
      if ((count || 0) >= (Number(room.pax) || 1)) {
        return NextResponse.json({
          success: false,
          message: `${room.room_type} ${room.room_number} is full — ${count} of ${room.pax} pax.`,
        }, { status: 409 });
      }
      patch.room_id = body.roomId;
      patch.assigned_by = actor.id;
      patch.assigned_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, data: guest, message: 'Nothing to change' });
    }

    const { data, error } = await supabaseAdmin
      .from('event_room_guests')
      .update(patch)
      .eq('id', body.id)
      .select(`${GUEST_FIELDS}, registration:event_registrations (${REG_FIELDS})`)
      .single();
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data,
      message: `${data.registration?.attendee_name || 'Guest'} updated`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// DELETE /api/events/room-guests?id=..&actorId=..
//   Taking somebody out of a room. The row existing IS the assignment, so
//   removing it is the whole of "they are not in that room" - there is no
//   "unassigned" state to tell apart from "never assigned".
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    }

    const { data: guest } = await supabaseAdmin
      .from('event_room_guests')
      .select('id, registration:event_registrations (attendee_name), room:event_rooms (room_number)')
      .eq('id', id)
      .maybeSingle();
    if (!guest) {
      return NextResponse.json({ success: false, message: 'That assignment could not be found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin.from('event_room_guests').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: `${guest.registration?.attendee_name || 'Guest'} taken out of ${guest.room?.room_number || 'the room'}`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}
