import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventForPublicSlug, readPass } from '@/lib/eventAccess';
import { formatPersonName } from '@/lib/eventFormat';
import { bedsToText, occupancyLabel, roomEntitlement } from '@/lib/rooms';

// GET /api/events/public/extras?slug=...   (header x-event-pass: <pass>)
//   What the holder availed on top of their registration, and - when one of
//   those is accommodation - where they are sleeping: the hotel, the room,
//   its beds, and who else is in it. The same pass as the photos and the ID:
//   it belongs to whoever unlocked with their password or card.
//
//   Roommates are named because the attendee is sharing a room with them and
//   needs to find them; nobody outside that room is listed.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const event = await eventForPublicSlug(searchParams.get('slug'));
    if (!event) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }
    const pass = readPass(request.headers.get('x-event-pass'), event.id);
    if (!pass) {
      return NextResponse.json({ success: false, locked: true, message: 'Unlock your profile first.' }, { status: 401 });
    }

    const { data: reg, error } = await supabaseAdmin
      .from('event_registrations')
      .select('id, event_id, attendee_name, addons, group_ref, status, deleted_at')
      .eq('id', pass.registrationId)
      .eq('event_id', event.id)
      .maybeSingle();
    if (error) throw error;
    if (!reg || reg.deleted_at || reg.status === 'cancelled') {
      return NextResponse.json({ success: false, locked: true, message: 'This registration is no longer active.' }, { status: 401 });
    }

    const held = (Array.isArray(reg.addons) ? reg.addons : []).filter((a) => a && (a.question || a.id));
    const extras = held.map((a) => ({ name: String(a.question || 'Extra').trim(), fee: Number(a.fee) || 0 }));

    // ---- Accommodation ----
    let accommodation = null;
    if (held.length > 0) {
      const { data: eventAddons } = await supabaseAdmin
        .from('event_addons').select('id, question, fee').eq('event_id', event.id);
      if (roomEntitlement(held, eventAddons).ok) {
        // The hotel the Accommodation screen names, else the event's venue.
        // (Read on its own: before event_accommodation_hotel.sql is run there
        // is no such column, and the venue is all there is.)
        let hotel = null;
        let address = null;
        const { data: stay, error: stayErr } = await supabaseAdmin
          .from('events').select('accommodation_hotel, accommodation_address').eq('id', event.id).maybeSingle();
        if (!stayErr && stay?.accommodation_hotel) {
          hotel = stay.accommodation_hotel;
          address = stay.accommodation_address || null;
        } else {
          hotel = event.location || null;
          address = event.loc_city && event.loc_city !== event.location ? event.loc_city : null;
        }
        accommodation = { hotel, address, room: null, roommates: [] };

        const { data: mine } = await supabaseAdmin
          .from('event_room_guests')
          .select('room_id')
          .eq('event_id', event.id)
          .eq('registration_id', reg.id)
          .maybeSingle();

        if (mine?.room_id) {
          // The room label comes from event_room_occupancy.sql; before that is
          // run the room is still shown, without it.
          const roomQuery = (fields) => supabaseAdmin.from('event_rooms').select(fields).eq('id', mine.room_id).maybeSingle();
          let { data: room, error: roomErr } = await roomQuery('id, room_type, room_number, pax, beds, notes, occupancy');
          if (roomErr && /occupancy/i.test(roomErr.message || '')) {
            ({ data: room, error: roomErr } = await roomQuery('id, room_type, room_number, pax, beds, notes'));
          }
          if (roomErr) throw roomErr;

          if (room) {
            const { data: others } = await supabaseAdmin
              .from('event_room_guests')
              .select('registration:event_registrations (id, attendee_name, group_ref, status, deleted_at)')
              .eq('room_id', room.id);
            const roommates = (others || [])
              .map((g) => g.registration)
              .filter((r) => r && r.id !== reg.id && !r.deleted_at && r.status !== 'cancelled')
              .map((r) => ({
                name: formatPersonName(r.attendee_name),
                sameGroup: !!reg.group_ref && r.group_ref === reg.group_ref,
              }))
              .sort((a, b) => (b.sameGroup - a.sameGroup) || a.name.localeCompare(b.name));

            const beds = Array.isArray(room.beds) ? room.beds : [];
            accommodation.room = {
              type: room.room_type,
              number: room.room_number,
              pax: Number(room.pax) || null,
              beds: beds.map((b) => ({ type: b.type, count: Number(b.count) || 1 })),
              bedsText: bedsToText(beds),
              occupancy: room.occupancy || null,
              occupancyLabel: occupancyLabel(room.occupancy),
            };
            accommodation.roommates = roommates;
          }
        }
      }
    }

    return NextResponse.json({ success: true, extras, accommodation }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
