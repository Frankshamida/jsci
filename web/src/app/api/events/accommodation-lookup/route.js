import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { formatPersonName, formatChurchName } from '@/lib/eventFormat';
import { bedsToText, occupancyLabel, roomEntitlement } from '@/lib/rooms';
import { isPlausibleUid } from '@/lib/rfid';
import { resolveEventCard } from '@/lib/rfidEventCard';
import { loadHolds, loadKids, holdName } from '@/lib/roomList/data';

// The attendee's own "where am I sleeping" (app/accommodation): a kiosk at the
// venue, or a phone. Nothing here changes anything.
//
//   GET ?events=1                    the events that have rooms, the one on now first
//   GET ?eventId=..&q=juan cruz      attendees whose name has every word - names only
//   GET ?eventId=..&registrationId=  their room: the hotel, the room, its beds,
//                                    and who they share it with
//   GET ?eventId=..&uid=..           the same, for the card they tapped
//
// Only a name and a church come back from a search, and only once three
// letters are typed; the room and the roommates only for the one person picked
// (or whose card was tapped). Roommates are named because the attendee shares
// the room with them and needs to find them - nobody outside it is listed.

export const dynamic = 'force-dynamic';

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const ok = (body) => NextResponse.json({ success: true, ...body }, { headers: { 'Cache-Control': 'no-store' } });
const live = (r) => r && !r.deleted_at && r.status !== 'cancelled';
const norm = (v) => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const dayMs = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
};

// ---- The events with rooms ----
async function eventsWithRooms() {
  const { data: events, error } = await supabaseAdmin
    .from('events')
    .select('id, title, event_date, end_date, location, loc_city, loc_province, image_url')
    .eq('is_active', true)
    .eq('is_published', true)
    .order('event_date', { ascending: false })
    .limit(200);
  if (error) throw error;
  const ids = (events || []).map((e) => e.id);
  if (!ids.length) return [];
  const { data: rooms } = await supabaseAdmin.from('event_rooms').select('event_id').in('event_id', ids);
  const withRooms = new Set((rooms || []).map((r) => r.event_id));
  // On now first, then the next one coming, then the most recent past.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = today.getTime();
  const rank = (e) => {
    const start = dayMs(e.event_date);
    const end = dayMs(e.end_date) || start;
    if (start <= t && t <= end) return [0, 0];
    if (start > t) return [1, start - t];
    return [2, t - end];
  };
  return (events || [])
    .filter((e) => withRooms.has(e.id))
    .map((e) => ({ ...e, _r: rank(e) }))
    .sort((a, b) => a._r[0] - b._r[0] || a._r[1] - b._r[1])
    .map(({ _r, ...e }) => ({
      id: e.id, title: e.title, eventDate: e.event_date, endDate: e.end_date,
      place: e.loc_city || e.location || '', image: e.image_url || null, now: _r[0] === 0,
    }));
}

// ---- Where one attendee sleeps ----
const ROOM_FIELDS = [
  'id, room_type, room_number, pax, beds, notes, floor, occupancy',
  'id, room_type, room_number, pax, beds, notes, occupancy',
  'id, room_type, room_number, pax, beds, notes',
];
async function readRoom(id) {
  let res = { data: null, error: null };
  for (const fields of ROOM_FIELDS) {
    res = await supabaseAdmin.from('event_rooms').select(fields).eq('id', id).maybeSingle();
    if (!res.error) break;
  }
  if (res.error) throw res.error;
  return res.data;
}

async function hotelOf(eventId) {
  const { data: stay, error } = await supabaseAdmin
    .from('events').select('location, loc_city, accommodation_hotel, accommodation_address').eq('id', eventId).maybeSingle();
  if (!error && stay?.accommodation_hotel) return { name: stay.accommodation_hotel, address: stay.accommodation_address || null };
  const { data: evt } = await supabaseAdmin.from('events').select('location, loc_city').eq('id', eventId).maybeSingle();
  return { name: evt?.location || null, address: evt?.loc_city && evt.loc_city !== evt.location ? evt.loc_city : null };
}

async function stayOf(eventId, reg) {
  const person = {
    id: reg.id,
    name: formatPersonName(reg.attendee_name),
    church: formatChurchName(reg.church_name) || '',
    tier: reg.price_tier || '',
  };
  const [{ data: guests }, holds, kids, { data: addons }] = await Promise.all([
    supabaseAdmin.from('event_room_guests')
      .select('id, room_id, registration_id, assigned_at, registration:event_registrations (id, attendee_name, church_name, group_ref, status, deleted_at)')
      .eq('event_id', eventId).order('assigned_at'),
    loadHolds(eventId),
    loadKids(eventId),
    supabaseAdmin.from('event_addons').select('id, question, fee').eq('event_id', eventId),
  ]);
  const allGuests = (guests || []).filter((g) => live(g.registration));
  const mine = allGuests.find((g) => g.registration_id === reg.id);
  const kidRow = kids.find((k) => k.registration_id === reg.id);
  const withAdult = kidRow ? allGuests.find((g) => g.id === kidRow.guest_id) : null;
  const heldFor = holds.find((h) => h.registration_id === reg.id);
  const roomId = mine?.room_id || withAdult?.room_id || null;

  if (!roomId) {
    const entitled = roomEntitlement(reg.addons, addons || []).ok;
    let state = entitled ? 'waiting' : 'none';
    let reserved = null;
    if (heldFor) {
      state = 'reserved';
      const r = await readRoom(heldFor.room_id);
      reserved = r ? { number: r.room_number, type: r.room_type } : null;
    }
    return { person, state, reserved, hotel: entitled || heldFor ? await hotelOf(eventId) : null };
  }

  const [room, hotel] = await Promise.all([readRoom(roomId), hotelOf(eventId)]);
  const kidsOf = (guestId) => kids.filter((k) => k.guest_id === guestId).map((k) => formatPersonName(k.registration.attendee_name));
  // Everybody else sleeping there: the attendees (with the kids in their bed),
  // somebody who is not an attendee, and a bed held for an attendee by name.
  const mates = [
    ...allGuests.filter((g) => g.room_id === roomId).map((g) => ({
      name: formatPersonName(g.registration.attendee_name),
      church: formatChurchName(g.registration.church_name) || '',
      kids: kidsOf(g.id),
      sameGroup: !!reg.group_ref && g.registration.group_ref === reg.group_ref,
      me: g.registration_id === reg.id,
      bedOf: withAdult && g.id === withAdult.id,
    })),
    ...holds.filter((h) => h.room_id === roomId).map((h) => ({
      name: formatPersonName(holdName(h)),
      church: h.note || '',
      kids: [],
      kind: h.registration_id ? 'reserved' : 'guest',
    })),
  ];
  return {
    person,
    state: 'assigned',
    // A kid in a parent's bed: theirs is the adult's.
    sharesBedWith: withAdult ? formatPersonName(withAdult.registration.attendee_name) : null,
    room: room ? {
      number: room.room_number,
      type: room.room_type,
      floor: room.floor || null,
      pax: Number(room.pax) || null,
      bedsText: bedsToText(Array.isArray(room.beds) ? room.beds : []),
      occupancy: occupancyLabel(room.occupancy),
      notes: room.notes || null,
    } : null,
    hotel,
    roommates: mates.filter((m) => !m.me)
      .sort((a, b) => (b.bedOf - a.bedOf) || (b.sameGroup - a.sameGroup) || a.name.localeCompare(b.name)),
    myKids: mine ? kidsOf(mine.id) : [],
  };
}

const REG = 'id, event_id, attendee_name, church_name, price_tier, addons, group_ref, status, deleted_at';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('events')) return ok({ events: await eventsWithRooms() });

    const eventId = String(searchParams.get('eventId') || '').trim();
    if (!eventId) return fail('Choose the event first.');

    // ---- A tapped card ----
    const uid = searchParams.get('uid');
    if (uid) {
      if (!isPlausibleUid(uid)) return fail('That card could not be read. Please tap it again.');
      const found = await resolveEventCard(eventId, uid, REG);
      if (!live(found.registration) || found.registration.event_id !== eventId) {
        return fail('This card is not linked to anybody at this event. Please search your name, or ask the registration desk.', 404);
      }
      return ok({ stay: await stayOf(eventId, found.registration) });
    }

    // ---- One attendee, picked from the search ----
    const registrationId = searchParams.get('registrationId');
    if (registrationId) {
      const { data: reg, error } = await supabaseAdmin.from('event_registrations').select(REG).eq('id', registrationId).maybeSingle();
      if (error) throw error;
      if (!live(reg) || reg.event_id !== eventId) return fail('That registration could not be found.', 404);
      return ok({ stay: await stayOf(eventId, reg) });
    }

    // ---- A name search ----
    const words = norm(searchParams.get('q')).split(' ').filter(Boolean);
    if (words.join('').length < 3) return fail('Type at least three letters of your name.');
    // The database is asked for the first letters of the longest word only -
    // "Mondoñedo" typed as "mondonedo" still comes back - and every word is
    // then matched here, accents and case aside.
    const longest = [...words].sort((a, b) => b.length - a.length)[0].replace(/[%_\\]/g, '').slice(0, 3);
    const { data: regs, error } = await supabaseAdmin
      .from('event_registrations')
      .select('id, attendee_name, original_attendee_name, church_name, status, deleted_at')
      .eq('event_id', eventId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .ilike('attendee_name', `%${longest}%`)
      .limit(300);
    if (error) throw error;
    const matches = (regs || [])
      .filter((r) => words.every((w) => norm(r.attendee_name).includes(w)))
      .map((r) => ({ id: r.id, name: formatPersonName(r.attendee_name), church: formatChurchName(r.church_name) || '' }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
    return ok({ matches });
  } catch (error) {
    return fail(error.message || 'Something went wrong', 500);
  }
}
