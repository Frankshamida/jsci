import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Where an event's attendees sleep: the hotel's name and address.
//
// Kept apart from the event itself because it is set from the Accommodation
// screen, by the people booking the rooms, and has nothing to do with the
// venue the programme is held in. See event_accommodation_hotel.sql.

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];
const MIGRATION = 'The hotel name needs its migration: run supabase/migrations/event_accommodation_hotel.sql in the Supabase SQL editor, then try again.';
const missingColumns = (error) => /accommodation_(hotel|address)/i.test(error?.message || '');

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

// GET /api/events/accommodation?eventId=..
export async function GET(request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('id, location, accommodation_hotel, accommodation_address')
      .eq('id', eventId)
      .maybeSingle();
    if (error) {
      // Not run yet: nothing is set, and that is an answer, not a failure.
      if (missingColumns(error)) return NextResponse.json({ success: true, data: { hotel: null, address: null }, migrationNeeded: true });
      throw error;
    }
    if (!data) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: { hotel: data.accommodation_hotel || null, address: data.accommodation_address || null } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PATCH /api/events/accommodation  { eventId, actorId, hotel, address }
//   Admins and Super Admins only. Blank clears it, and the attendees are then
//   shown the event venue again.
export async function PATCH(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) {
      return NextResponse.json({ success: false, message: 'Only Admins and Super Admins can change the hotel.' }, { status: 403 });
    }
    if (!body.eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });

    const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null;
    const patch = {
      accommodation_hotel: clean(body.hotel, 160),
      accommodation_address: clean(body.address, 300),
    };

    const { data, error } = await supabaseAdmin
      .from('events')
      .update(patch)
      .eq('id', body.eventId)
      .select('id, accommodation_hotel, accommodation_address')
      .maybeSingle();
    if (error) {
      if (missingColumns(error)) return NextResponse.json({ success: false, message: MIGRATION }, { status: 500 });
      throw error;
    }
    if (!data) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      data: { hotel: data.accommodation_hotel || null, address: data.accommodation_address || null },
      message: data.accommodation_hotel ? `Hotel set to ${data.accommodation_hotel}` : 'Hotel cleared - attendees will see the event venue',
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
