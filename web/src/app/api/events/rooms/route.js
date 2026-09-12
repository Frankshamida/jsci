import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  BED_TYPES,
  MAX_ROOMS_PER_ADD,
  compareRoomNumbers,
  normalizeBeds,
  normalizePax,
  parseRoomNumbers,
  roomTypeName,
} from '@/lib/rooms';

// The rooms booked for an event, and the beds in them.
//
// See supabase/migrations/event_rooms.sql for why this is a row per room
// rather than the hotel's own grouped-by-type sheet: one row per room is the
// only shape that can answer "is 408 taken?".
//
// Adding several at once is a convenience of the form, not of the table -
// "308, 408, 508" arrives here as three rooms and is inserted as three rows.

// Only these roles may touch the room list. Reading it is open to any signed-in
// screen; writing it is the same decision as editing the event itself.
const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

// Server-side RBAC: verify the acting user is an Admin or Super Admin.
// Returns the user row on success, or null if unauthorized/unknown.
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

// The one failure worth naming by hand. Everything else that can go wrong
// here is transient; this one means the migration has not been run, and a
// bare "relation does not exist" sends somebody looking for a bug in the form.
const explain = (error) => (/event_rooms/i.test(error?.message || '')
  ? 'Accommodation needs its migration: run supabase/migrations/event_rooms.sql in the Supabase SQL editor, then try again.'
  : (error?.message || 'Something went wrong'));

// Rooms as a person reads them: by type, then 204 before 307 before 1002,
// with the named rooms ("Function Hall") after the numbered ones. Sorted here
// rather than in SQL because a text sort puts 1002 first, which looks like
// broken data.
const sortRooms = (rows) => [...(rows || [])].sort((a, b) => (
  String(a.room_type || '').localeCompare(String(b.room_type || ''))
  || compareRoomNumbers(a.room_number, b.room_number)
));

const ROOM_FIELDS = 'id, event_id, room_type, room_number, pax, beds, notes, created_at, updated_at, created_by';

// A stored row, in the shape the screen wants: beds always an array, never a
// null that every caller has to guard.
const shape = (r) => ({ ...r, beds: Array.isArray(r?.beds) ? r.beds : [] });

// GET /api/events/rooms?eventId=..
//   Every room booked for this event, ordered for reading. One request: the
//   screen groups by type itself, and asking per type would be a request per
//   heading on a page that already knows the whole list is small.
//
// GET /api/events/rooms?bedTypes=1
//   The bed names the form suggests. Served from here so the API and the form
//   cannot drift on what a "Queen Sized Bed" is called.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get('bedTypes')) {
      return NextResponse.json({ success: true, data: BED_TYPES });
    }

    const eventId = searchParams.get('eventId');
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('event_rooms')
      .select(ROOM_FIELDS)
      .eq('event_id', eventId);
    if (error) throw error;

    return NextResponse.json({ success: true, data: sortRooms(data).map(shape) });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// POST /api/events/rooms
//   { eventId, actorId, roomType, roomNumbers | roomNumber, pax, beds, notes }
//
//   One type of room, one or more numbers. The numbers are what the hotel
//   sent - "308, 408 and 508" - and each becomes its own row.
//
//   A number that is already booked for this event is SKIPPED rather than
//   failing the whole request: adding "204, 205, 206" when 204 was entered
//   yesterday should add the two new ones and say so, not refuse all three
//   and leave the person to work out which one was the problem.
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) {
      return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    }

    const eventId = body.eventId;
    const room_type = roomTypeName(body.roomType);
    const numbers = parseRoomNumbers(body.roomNumbers ?? body.roomNumber);
    const beds = normalizeBeds(body.beds);
    const pax = normalizePax(body.pax, beds);
    const notes = String(body.notes || '').trim().slice(0, 500) || null;

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'Choose an event first' }, { status: 400 });
    }
    if (!room_type) {
      return NextResponse.json({ success: false, message: 'Give the room a type - Family Deluxe, Executive, Dormtype' }, { status: 400 });
    }
    if (numbers.length === 0) {
      return NextResponse.json({ success: false, message: 'Give at least one room number' }, { status: 400 });
    }

    // The event has to exist. Without this a typo in the id would surface as
    // a foreign-key error, which says nothing about what to do next.
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, title')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ success: false, message: 'That event could not be found' }, { status: 404 });
    }

    // What is already booked, so a repeat is skipped rather than thrown.
    // The unique index is still the authority - two admins adding 408 at the
    // same moment race past this check, and the insert below catches it.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('event_rooms')
      .select('room_number')
      .eq('event_id', eventId);
    if (exErr) throw exErr;
    const taken = new Set((existing || []).map((r) => String(r.room_number).toLowerCase()));

    const fresh = numbers.filter((n) => !taken.has(n.toLowerCase()));
    const skipped = numbers.filter((n) => taken.has(n.toLowerCase()));

    if (fresh.length === 0) {
      return NextResponse.json({
        success: false,
        message: numbers.length === 1
          ? `Room ${numbers[0]} is already on this event's list.`
          : `Those rooms are already on this event's list: ${skipped.join(', ')}.`,
      }, { status: 409 });
    }

    const payload = fresh.slice(0, MAX_ROOMS_PER_ADD).map((room_number) => ({
      event_id: eventId,
      room_type,
      room_number,
      pax,
      beds,
      notes,
      created_by: actor.id,
    }));

    const { data, error } = await supabaseAdmin
      .from('event_rooms')
      .insert(payload)
      .select(ROOM_FIELDS);
    if (error) throw error;

    const made = (data || []).map(shape);
    return NextResponse.json({
      success: true,
      data: made,
      skipped,
      message: [
        made.length === 1
          ? `Room ${made[0].room_number} added`
          : `${made.length} rooms added`,
        skipped.length > 0
          ? `${skipped.length === 1 ? 'Room' : 'Rooms'} ${skipped.join(', ')} ${skipped.length === 1 ? 'was' : 'were'} already on the list`
          : '',
      ].filter(Boolean).join(' — '),
    });
  } catch (error) {
    // The unique index firing means somebody else added that number between
    // the check above and the insert. Said as what it is, not as a violation.
    if (/uq_event_rooms_number|duplicate key/i.test(error?.message || '')) {
      return NextResponse.json({
        success: false,
        message: 'One of those room numbers was just added by somebody else. Refresh the list and try again.',
      }, { status: 409 });
    }
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// PATCH /api/events/rooms  { id, actorId, roomType, roomNumber, pax, beds, notes }
//   One room, corrected. Only the fields sent are changed - a screen that
//   edits the bed list must not blank the notes by not mentioning them.
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

    const { data: room } = await supabaseAdmin
      .from('event_rooms')
      .select(ROOM_FIELDS)
      .eq('id', body.id)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ success: false, message: 'That room could not be found' }, { status: 404 });
    }

    const patch = {};
    if (body.roomType !== undefined) {
      const room_type = roomTypeName(body.roomType);
      if (!room_type) {
        return NextResponse.json({ success: false, message: 'A room needs a type' }, { status: 400 });
      }
      patch.room_type = room_type;
    }
    if (body.roomNumber !== undefined) {
      // One room, so only the first name on the line is taken. Splitting one
      // room into three by editing its number would leave two rooms nobody
      // asked for.
      const [room_number] = parseRoomNumbers(body.roomNumber);
      if (!room_number) {
        return NextResponse.json({ success: false, message: 'A room needs a number' }, { status: 400 });
      }
      patch.room_number = room_number;
    }
    // Beds first: pax falls back to what the beds sleep, and it can only do
    // that against the NEW list.
    const beds = body.beds !== undefined ? normalizeBeds(body.beds) : (Array.isArray(room.beds) ? room.beds : []);
    if (body.beds !== undefined) patch.beds = beds;
    if (body.pax !== undefined) patch.pax = normalizePax(body.pax, beds);
    if (body.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 500) || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, data: shape(room), message: 'Nothing to change' });
    }

    const { data, error } = await supabaseAdmin
      .from('event_rooms')
      .update(patch)
      .eq('id', body.id)
      .select(ROOM_FIELDS)
      .single();
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: shape(data),
      message: `Room ${data.room_number} updated`,
    });
  } catch (error) {
    if (/uq_event_rooms_number|duplicate key/i.test(error?.message || '')) {
      return NextResponse.json({
        success: false,
        message: 'Another room at this event already has that number.',
      }, { status: 409 });
    }
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// DELETE /api/events/rooms?id=..&actorId=..
//   A room taken back off the block - the hotel gave it to somebody else, or
//   it was typed twice.
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

    const { data: room } = await supabaseAdmin
      .from('event_rooms')
      .select('id, room_number')
      .eq('id', id)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ success: false, message: 'That room could not be found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin.from('event_rooms').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: `Room ${room.room_number} removed` });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}
