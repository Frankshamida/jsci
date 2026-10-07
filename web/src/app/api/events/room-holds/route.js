import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { holdName, holdsMissing } from '@/lib/roomList/data';
import { queueRoomSheetSync } from '@/lib/roomList/liveSheet';

// Beds held for somebody by name - see supabase/migrations/event_room_holds.sql.
//
//   GET    ?eventId=..                                   every held bed at the event
//   POST   { eventId, roomId, actorId, registrationId }  hold a bed for an attendee
//   POST   { eventId, roomId, actorId, name, note }      hold a bed for somebody who is not one
//   DELETE ?id=..&actorId=..                             let the bed go
//
// A held bed is a bed: a room is full when its guests and its held beds fill
// it. The names go on the rooming list and the live Google Sheets like
// anybody's, so every change here updates those.

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];
const MIGRATION = 'Reserving beds by name needs its migration: run supabase/migrations/event_room_holds.sql in the Supabase SQL editor, then try again.';

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const explain = (error) => (holdsMissing(error) ? MIGRATION : (error?.message || 'Something went wrong'));
const cleanName = (raw) => String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
const shape = (h) => ({ id: h.id, roomId: h.room_id, registrationId: h.registration_id, name: holdName(h), note: h.note || '', createdAt: h.created_at });
const FIELDS = 'id, room_id, registration_id, name, note, created_at, registration:event_registrations (attendee_name, status, deleted_at)';

export async function GET(request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (!eventId) return fail('eventId required');
    const { data, error } = await supabaseAdmin.from('event_room_holds').select(FIELDS).eq('event_id', eventId).order('created_at');
    if (error) {
      if (holdsMissing(error)) return NextResponse.json({ success: true, data: [] });
      throw error;
    }
    const live = (data || []).filter((h) => !h.registration_id || (h.registration && !h.registration.deleted_at && h.registration.status !== 'cancelled'));
    return NextResponse.json({ success: true, data: live.map(shape) });
  } catch (error) {
    return fail(explain(error), 500);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return fail('Access denied. Admins only.', 403);
    const { eventId, roomId } = body;
    if (!eventId || !roomId) return fail('eventId and roomId are required');

    const { data: room } = await supabaseAdmin
      .from('event_rooms').select('id, event_id, room_type, room_number, pax').eq('id', roomId).maybeSingle();
    if (!room) return fail('That room could not be found', 404);
    if (room.event_id !== eventId) return fail('That room belongs to a different event');

    // Who for: an attendee, or a name.
    let name = cleanName(body.name);
    let registrationId = null;
    if (body.registrationId) {
      const { data: reg } = await supabaseAdmin
        .from('event_registrations').select('id, event_id, attendee_name, status, deleted_at').eq('id', body.registrationId).maybeSingle();
      if (!reg || reg.deleted_at) return fail('That registration could not be found', 404);
      if (reg.event_id !== eventId) return fail(`${reg.attendee_name} is registered for a different event`);
      if (reg.status === 'cancelled') return fail(`${reg.attendee_name} cancelled their registration`);
      const { data: inRoom } = await supabaseAdmin
        .from('event_room_guests').select('room:event_rooms (room_number)').eq('event_id', eventId).eq('registration_id', reg.id).maybeSingle();
      if (inRoom) return fail(`${reg.attendee_name} already has a room (${inRoom.room?.room_number || 'another room'}). To put them in this one, move them instead of reserving a bed.`, 409);
      registrationId = reg.id;
      name = reg.attendee_name;
    }
    if (!name) return fail('Type the name the bed is held for');

    // Is there a bed: guests and held beds, against the pax.
    const [{ count: guests }, holds] = await Promise.all([
      supabaseAdmin.from('event_room_guests').select('id', { count: 'exact', head: true }).eq('room_id', roomId),
      supabaseAdmin.from('event_room_holds').select('id, registration_id, room_id').eq('room_id', roomId),
    ]);
    if (holds.error) throw holds.error;
    const used = (guests || 0) + (holds.data || []).length;
    if (used >= (Number(room.pax) || 1)) {
      return fail(`${room.room_type} ${room.room_number} is full — ${used} of ${room.pax} pax.`, 409);
    }

    const { data, error } = await supabaseAdmin
      .from('event_room_holds')
      .insert([{
        event_id: eventId,
        room_id: roomId,
        registration_id: registrationId,
        name,
        note: String(body.note || '').trim().slice(0, 200) || null,
        created_by: actor.id,
      }])
      .select(FIELDS)
      .single();
    if (error) {
      if (/uq_event_room_holds_reg|duplicate key/i.test(error.message || '')) {
        return fail(`${name} already has a bed held for them at this event. Let that one go first.`, 409);
      }
      throw error;
    }
    queueRoomSheetSync(eventId);
    return NextResponse.json({
      success: true,
      data: shape(data),
      message: registrationId ? `Bed held for ${name} in ${room.room_number}` : `${name} added to ${room.room_number}`,
    });
  } catch (error) {
    return fail(explain(error), 500);
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (!(await verifyEventManager(searchParams.get('actorId')))) return fail('Access denied. Admins only.', 403);
    const id = searchParams.get('id');
    if (!id) return fail('id required');
    const { data: hold } = await supabaseAdmin
      .from('event_room_holds').select('id, event_id, registration_id, name, room:event_rooms (room_number)').eq('id', id).maybeSingle();
    if (!hold) return fail('That held bed could not be found', 404);
    const { error } = await supabaseAdmin.from('event_room_holds').delete().eq('id', id);
    if (error) throw error;
    queueRoomSheetSync(hold.event_id);
    const where = hold.room?.room_number || 'the room';
    return NextResponse.json({
      success: true,
      message: hold.registration_id ? `Bed for ${hold.name} in ${where} let go` : `${hold.name} taken out of ${where}`,
    });
  } catch (error) {
    return fail(explain(error), 500);
  }
}
