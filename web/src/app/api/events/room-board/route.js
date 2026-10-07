import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { compareRoomNumbers } from '@/lib/rooms';
import { holdName, loadHolds, loadPeople } from '@/lib/roomList/data';

// Everything the rooms board shows, in one request (components/accommodation/
// RoomBoard.jsx - Events & Content > Accommodation, and an event's
// Registrations > Accommodation tab):
//
//   rooms    every room, with its beds, floor, label and beds kept back
//   guests   who is in which room
//   holds    beds held for somebody by name
//   people   everybody on the event: whether they availed accommodation,
//            whether they have been verified at the desk, and what they owe -
//            the board assigns anybody who availed it, verified or not
//
// GET /api/events/room-board?eventId=..

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const ROOM_FIELDS = [
  'id, event_id, room_type, room_number, pax, beds, notes, floor, occupancy, reserved_beds, reserved_for',
  'id, event_id, room_type, room_number, pax, beds, notes, occupancy, reserved_beds, reserved_for',
  'id, event_id, room_type, room_number, pax, beds, notes, occupancy',
  'id, event_id, room_type, room_number, pax, beds, notes',
];

async function loadBoardRooms(eventId) {
  let res = { data: [], error: null };
  for (const fields of ROOM_FIELDS) {
    res = await supabaseAdmin.from('event_rooms').select(fields).eq('event_id', eventId);
    if (!res.error) break;
  }
  if (res.error) throw res.error;
  return (res.data || [])
    .map((r) => ({ ...r, beds: Array.isArray(r.beds) ? r.beds : [] }))
    .sort((a, b) => String(a.room_type || '').localeCompare(String(b.room_type || '')) || compareRoomNumbers(a.room_number, b.room_number));
}

export async function GET(request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });

    const [rooms, guestsRes, holds, people, attendance] = await Promise.all([
      loadBoardRooms(eventId),
      supabaseAdmin.from('event_room_guests').select('id, room_id, registration_id, assigned_at').eq('event_id', eventId).order('assigned_at'),
      loadHolds(eventId),
      loadPeople(eventId),
      supabaseAdmin.from('event_day_attendance').select('registration_id').eq('event_id', eventId)
        .then((r) => r, () => ({ data: [] })),
    ]);
    if (guestsRes.error) throw guestsRes.error;

    // Verified at the desk = checked in on any day (what the desk calls Registered).
    const verified = new Set((attendance.data || []).map((a) => a.registration_id));
    const live = new Set(people.map((p) => p.id));
    const guests = (guestsRes.data || []).filter((g) => live.has(g.registration_id));
    const roomOf = new Map(guests.map((g) => [g.registration_id, g.room_id]));
    const heldIn = new Map(holds.filter((h) => h.registration_id).map((h) => [h.registration_id, h.room_id]));

    return NextResponse.json({
      success: true,
      data: {
        rooms,
        guests: guests.map((g) => ({ id: g.id, roomId: g.room_id, registrationId: g.registration_id, assignedAt: g.assigned_at })),
        holds: holds.map((h) => ({ id: h.id, roomId: h.room_id, registrationId: h.registration_id, name: holdName(h), note: h.note || '', createdAt: h.created_at })),
        people: people.map((p) => ({
          ...p,
          verified: verified.has(p.id),
          roomId: roomOf.get(p.id) || null,
          heldRoomId: heldIn.get(p.id) || null,
        })),
      },
    });
  } catch (error) {
    const msg = error?.message || '';
    return NextResponse.json({
      success: false,
      message: /event_rooms|event_room_guests/i.test(msg)
        ? 'Accommodation needs its migrations: run supabase/migrations/event_rooms.sql and event_room_guests.sql in the Supabase SQL editor.'
        : msg || 'Something went wrong',
    }, { status: 500 });
  }
}
