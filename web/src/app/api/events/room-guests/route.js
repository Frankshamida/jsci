import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { roomEntitlement, roomHold } from '@/lib/rooms';
import { queueRoomSheetSync } from '@/lib/roomList/liveSheet';

// Always live: rooms change at the desk while this is on screen, and a cached
// read shows a bed as kept back after it was freed.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

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

// A room, read with as many of the newer columns as the database has: the
// first field list that reads wins (see event_room_occupancy.sql and
// event_room_reserved.sql).
async function readRoom(id, fieldLists) {
  let res = { data: null, error: null };
  for (const fields of fieldLists) {
    res = await supabaseAdmin.from('event_rooms').select(fields).eq('id', id).maybeSingle();
    if (!res.error) return res;
  }
  return res;
}
const ROOM_BASE = 'id, event_id, room_type, room_number, pax';
const HOLD = 'reserved_beds, reserved_for';

// Beds held back under Accommodation > Reserve are the last a room gives out,
// and only when the desk says so (useReserved). Returns the refusal, or null.
function heldRefusal(room, used, useReserved) {
  const hold = roomHold(room, used);
  if (useReserved || hold.open > 0 || hold.held === 0) return null;
  const beds = hold.held === 1 ? 'Its last free bed is' : `Its ${hold.held} free beds are`;
  return {
    success: false,
    result: 'reserved',
    held: hold.held,
    message: `${room.room_type} ${room.room_number}: ${beds} reserved${room.reserved_for ? ` for ${room.reserved_for}` : ''}.`,
  };
}

// A room nobody is in any more is nobody's: its All Boys / All Girls / Family
// label goes with the last guest, so the next people are not turned away by
// a label left over from somebody who has gone. Returns whether it cleared.
// Who a room is for, as people say it.
const OCC_LABEL = { boys: 'All Boys', girls: 'All Girls', family: 'Family' };

// Moving somebody keeps them with their own kind: a guest out of an All Boys
// room goes into another All Boys room, an empty unlabelled one (which then
// becomes All Boys), or a Family room - never into an All Girls room, and the
// other way round. Returns a refusal message, or '' when the move is fine.
function moveRefusal(fromOcc, toRoom, name) {
  const toOcc = toRoom?.occupancy || null;
  if (!fromOcc || !toOcc || toOcc === fromOcc || toOcc === 'family') return '';
  return `${toRoom.room_number} is ${OCC_LABEL[toOcc] || toOcc} - ${name} is from an ${OCC_LABEL[fromOcc] || fromOcc} room. `
    + `Choose an ${OCC_LABEL[fromOcc] || fromOcc}, Family or empty room.`;
}

// The label goes with them into an unlabelled room.
async function carryLabel(fromOcc, toRoom) {
  if (!fromOcc || fromOcc === 'family' || !toRoom || toRoom.occupancy) return null;
  try {
    const { data } = await supabaseAdmin.from('event_rooms')
      .update({ occupancy: fromOcc }).eq('id', toRoom.id).is('occupancy', null).select('id, occupancy');
    return data?.[0] || null;
  } catch { return null; }
}

// Beds held for somebody by name (event_room_holds.sql) take a bed like a
// guest does - except the one held for the person being put in, which their
// room replaces. Before that migration there are none.
async function heldCount(roomId, exceptRegistrationId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('event_room_holds').select('id, registration_id').eq('room_id', roomId);
    if (error) return 0;
    return (data || []).filter((h) => !exceptRegistrationId || h.registration_id !== exceptRegistrationId).length;
  } catch { return 0; }
}

// Given a room: the bed held for them, wherever it was, is not needed now.
async function dropHoldOf(eventId, registrationId) {
  try {
    await supabaseAdmin.from('event_room_holds').delete().eq('event_id', eventId).eq('registration_id', registrationId);
  } catch { /* no holds table yet */ }
}

async function releaseIfEmpty(roomId) {
  if (!roomId) return false;
  try {
    const { count } = await supabaseAdmin
      .from('event_room_guests').select('id', { count: 'exact', head: true }).eq('room_id', roomId);
    if ((count || 0) > 0) return false;
    const { data } = await supabaseAdmin
      .from('event_rooms').update({ occupancy: null }).eq('id', roomId).not('occupancy', 'is', null).select('id');
    return (data || []).length > 0;
  } catch { return false; /* no occupancy column yet: nothing to clear */ }
}
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
//   { eventId, roomId, registrationId, actorId, notes, useReserved }
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
    const { data: room, error: roomErr } = await readRoom(roomId, [`${ROOM_BASE}, ${HOLD}`, ROOM_BASE]);
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

    const taken = (inRoom || []).length + await heldCount(roomId, registrationId);
    if (taken >= (Number(room.pax) || 1)) {
      return NextResponse.json({
        success: false,
        result: 'full',
        registration: reg,
        room,
        message: `${room.room_type} ${room.room_number} is full — ${taken} of ${room.pax} pax. Use another room, or raise its pax under Accommodation.`,
      }, { status: 409 });
    }
    const held = heldRefusal(room, taken, !!body.useReserved);
    if (held) return NextResponse.json({ ...held, registration: reg, room }, { status: 409 });

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

    await dropHoldOf(eventId, registrationId);
    const from = prior?.room?.room_number;
    const clearedRooms = prior?.room_id && prior.room_id !== roomId && (await releaseIfEmpty(prior.room_id)) ? [prior.room_id] : [];
    queueRoomSheetSync(eventId); // the live Google Sheet, if the event has one
    return NextResponse.json({
      success: true,
      clearedRooms,
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

// PATCH /api/events/room-guests  { id, actorId, roomId, notes, useReserved }
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

    let moveFromOcc = null;
    let moveToRoom = null;
    if (body.roomId && body.roomId !== guest.room_id) {
      // Before event_room_occupancy.sql there are no labels to keep, and
      // before event_room_reserved.sql nothing is held.
      const { data: room } = await readRoom(body.roomId, [
        `${ROOM_BASE}, occupancy, ${HOLD}`, `${ROOM_BASE}, occupancy`, ROOM_BASE,
      ]);
      const { data: fromRoom } = await supabaseAdmin.from('event_rooms').select('occupancy').eq('id', guest.room_id).maybeSingle();
      moveFromOcc = fromRoom?.occupancy || null;
      moveToRoom = room;
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
      const used = (count || 0) + await heldCount(body.roomId, guest.registration_id);
      if (used >= (Number(room.pax) || 1)) {
        return NextResponse.json({
          success: false,
          message: `${room.room_type} ${room.room_number} is full — ${used} of ${room.pax} pax.`,
        }, { status: 409 });
      }
      const held = heldRefusal(room, used, !!body.useReserved);
      if (held) return NextResponse.json(held, { status: 409 });
      const refusal = moveRefusal(moveFromOcc, room, guest.registration?.attendee_name || 'This guest');
      if (refusal) return NextResponse.json({ success: false, result: 'wrong_room', message: refusal }, { status: 409 });
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

    const labelled = patch.room_id ? await carryLabel(moveFromOcc, moveToRoom) : null;
    if (patch.room_id) queueRoomSheetSync(guest.event_id);
    const clearedRooms = patch.room_id && (await releaseIfEmpty(guest.room_id)) ? [guest.room_id] : [];
    return NextResponse.json({
      success: true,
      data,
      clearedRooms,
      labelled,
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
      .select('id, room_id, event_id, registration:event_registrations (attendee_name), room:event_rooms (room_number)')
      .eq('id', id)
      .maybeSingle();
    if (!guest) {
      return NextResponse.json({ success: false, message: 'That assignment could not be found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin.from('event_room_guests').delete().eq('id', id);
    if (error) throw error;

    const cleared = await releaseIfEmpty(guest.room_id);
    queueRoomSheetSync(guest.event_id);
    return NextResponse.json({
      success: true,
      clearedRooms: cleared ? [guest.room_id] : [],
      message: `${guest.registration?.attendee_name || 'Guest'} taken out of ${guest.room?.room_number || 'the room'}`
        + (cleared ? ' - the room is empty, so its label was cleared' : ''),
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}
