import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isChildTier } from '@/lib/rooms';
import { queueRoomSheetSync } from '@/lib/roomList/liveSheet';

// A kid sleeping in an adult's bed (supabase/migrations/event_room_kids.sql).
//
// POST   { eventId, guestId, registrationId, actorId }   put the kid with that adult
// DELETE ?id=..&actorId=..                              take the kid out
//
// The kid takes no bed - a room of 4 with 4 adults still takes a parent's kid -
// and is written with the adult on the room's card, the rooming list and the
// live Google Sheets: "Frank Gomez [Kid: Miaka Arquilano]". Only a child: an
// attendee whose age group has an upper age (Kid, 6-10 years old). A kid with
// a bed of their own gives it up to share the adult's.

export const dynamic = 'force-dynamic';

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];
const MIGRATION_HINT = 'Kids in a bed need their migration: run supabase/migrations/event_room_kids.sql in the Supabase SQL editor, then try again.';
const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const explain = (error) => (/event_room_kids/i.test(error?.message || '') ? MIGRATION_HINT : error?.message || 'Something went wrong');

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

// A room nobody is in any more is nobody's: its label goes with the last
// guest, as it does when the desk takes the last person out.
async function releaseIfEmpty(roomId) {
  if (!roomId) return false;
  try {
    const { count } = await supabaseAdmin.from('event_room_guests').select('id', { count: 'exact', head: true }).eq('room_id', roomId);
    if ((count || 0) > 0) return false;
    const { data } = await supabaseAdmin.from('event_rooms').update({ occupancy: null }).eq('id', roomId).not('occupancy', 'is', null).select('id');
    return (data || []).length > 0;
  } catch { return false; }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return fail('Access denied. Admins only.', 403);
    const { eventId, guestId, registrationId } = body;
    if (!eventId || !guestId || !registrationId) return fail('eventId, guestId and registrationId are required');

    // ---- The adult, and the room they are in ----
    const { data: adult, error: adultErr } = await supabaseAdmin
      .from('event_room_guests')
      .select('id, event_id, room_id, registration_id, registration:event_registrations (attendee_name), room:event_rooms (room_number)')
      .eq('id', guestId)
      .maybeSingle();
    if (adultErr) throw adultErr;
    if (!adult || adult.event_id !== eventId) return fail('That guest is not in a room at this event any more.', 404);
    if (adult.registration_id === registrationId) return fail('That is the adult themselves.');

    // ---- The kid ----
    const [{ data: kid, error: kidErr }, { data: tiers }] = await Promise.all([
      supabaseAdmin.from('event_registrations')
        .select('id, event_id, attendee_name, price_tier, status, deleted_at')
        .eq('id', registrationId).maybeSingle(),
      supabaseAdmin.from('event_price_tiers').select('*').eq('event_id', eventId).order('position')
        .then((r) => r, () => ({ data: [] })),
    ]);
    if (kidErr) throw kidErr;
    if (!kid || kid.deleted_at || kid.event_id !== eventId) return fail('That attendee could not be found at this event.', 404);
    if (kid.status === 'cancelled') return fail(`${kid.attendee_name} cancelled their registration.`);
    if (!isChildTier({ event_price_tiers: tiers || [] }, kid.price_tier)) {
      return fail(`${kid.attendee_name} is registered as ${kid.price_tier || 'an adult'} - only a kid shares a bed. Give them a bed of their own.`);
    }

    // An adult sharing somebody's bed cannot have a kid in it as well.
    const { data: adultIsKid } = await supabaseAdmin.from('event_room_kids')
      .select('id').eq('event_id', eventId).eq('registration_id', adult.registration_id).maybeSingle();
    if (adultIsKid) return fail(`${adult.registration?.attendee_name || 'That guest'} is sharing a bed already.`);

    // ---- A bed of their own goes: they share the adult's now ----
    const { data: ownBed } = await supabaseAdmin.from('event_room_guests')
      .select('id, room_id, room:event_rooms (room_number)')
      .eq('event_id', eventId).eq('registration_id', registrationId).maybeSingle();
    if (ownBed) {
      // Their own kids, if they had any, cannot come with them into a shared bed.
      const { count: theirKids } = await supabaseAdmin.from('event_room_kids')
        .select('id', { count: 'exact', head: true }).eq('guest_id', ownBed.id);
      if ((theirKids || 0) > 0) return fail(`${kid.attendee_name} has a kid in their bed in ${ownBed.room?.room_number || 'their room'}. Move that kid first.`);
    }

    // With one adult at a time: putting them with another adult moves them.
    const { data: saved, error } = await supabaseAdmin
      .from('event_room_kids')
      .upsert([{ event_id: eventId, guest_id: guestId, registration_id: registrationId, created_by: actor.id, created_at: new Date().toISOString() }],
        { onConflict: 'event_id,registration_id', ignoreDuplicates: false })
      .select('id, guest_id, registration_id')
      .single();
    if (error) throw error;

    let freed = '';
    if (ownBed) {
      await supabaseAdmin.from('event_room_guests').delete().eq('id', ownBed.id);
      if (ownBed.room_id !== adult.room_id) await releaseIfEmpty(ownBed.room_id);
      freed = ownBed.room?.room_number || '';
    }
    // A bed held for them by name is not needed either.
    try { await supabaseAdmin.from('event_room_holds').delete().eq('event_id', eventId).eq('registration_id', registrationId); } catch { /* no holds table yet */ }

    queueRoomSheetSync(eventId);
    return NextResponse.json({
      success: true,
      data: saved,
      freedRoom: freed || null,
      message: `${kid.attendee_name} sleeps with ${adult.registration?.attendee_name || 'them'} in ${adult.room?.room_number || 'the room'}`
        + (freed ? ` - their own bed in ${freed} is free now` : ''),
    });
  } catch (error) {
    return fail(explain(error), 500);
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) return fail('Access denied. Admins only.', 403);
    const id = searchParams.get('id');
    if (!id) return fail('id required');

    const { data: row, error: readErr } = await supabaseAdmin
      .from('event_room_kids')
      .select('id, event_id, registration:event_registrations (attendee_name), guest:event_room_guests (room:event_rooms (room_number))')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return fail('That kid is not in a room any more.', 404);

    const { error } = await supabaseAdmin.from('event_room_kids').delete().eq('id', id);
    if (error) throw error;
    queueRoomSheetSync(row.event_id);
    return NextResponse.json({
      success: true,
      message: `${row.registration?.attendee_name || 'Kid'} taken out of ${row.guest?.room?.room_number || 'the room'}`,
    });
  } catch (error) {
    return fail(explain(error), 500);
  }
}
