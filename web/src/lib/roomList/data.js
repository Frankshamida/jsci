// What an event's rooming list is filled from: its rooms, who is in them,
// and the beds held for somebody by name. Shared by the rooms board, the
// import/export route and the live Google Sheets, so all of them show the
// same names.
import { supabaseAdmin } from '@/lib/supabase';
import { roomEntitlement } from '@/lib/rooms';
import { exemptCreditLeft, registrationFeeOf } from '@/lib/exemption';

export async function loadRooms(eventId) {
  const base = 'id, event_id, room_type, room_number, pax';
  let res = await supabaseAdmin.from('event_rooms').select(`${base}, reserved_beds, reserved_for`).eq('event_id', eventId);
  if (res.error && /reserved_/i.test(res.error.message || '')) {
    res = await supabaseAdmin.from('event_rooms').select(base).eq('event_id', eventId);
  }
  if (res.error) throw res.error;
  return res.data || [];
}

// Everybody in a room, oldest assignment first. A registration that was
// cancelled or binned keeps its row through the foreign key but is nobody's
// roommate any more, so it is left out - of the screen and of the list.
export async function loadGuests(eventId) {
  const { data, error } = await supabaseAdmin
    .from('event_room_guests')
    .select('id, room_id, registration_id, assigned_at, registration:event_registrations (attendee_name, status, deleted_at)')
    .eq('event_id', eventId)
    .order('assigned_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter((g) => g.registration && !g.registration.deleted_at && g.registration.status !== 'cancelled');
}

/** Missing table = the migration has not been run: no holds yet, not an error. */
export const holdsMissing = (error) => /event_room_holds/i.test(error?.message || '');

// Beds held by name (event_room_holds.sql), oldest first. A hold for an
// attendee who has since cancelled is no longer anybody's.
export async function loadHolds(eventId) {
  const { data, error } = await supabaseAdmin
    .from('event_room_holds')
    .select('id, room_id, registration_id, name, note, created_at, registration:event_registrations (attendee_name, status, deleted_at)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) {
    if (holdsMissing(error)) return [];
    throw error;
  }
  return (data || []).filter((h) => !h.registration_id
    || (h.registration && !h.registration.deleted_at && h.registration.status !== 'cancelled'));
}

/** The name a hold is shown and written under: the attendee's own, else the one typed. */
export const holdName = (h) => (h.registration_id && h.registration?.attendee_name) || h.name;

/**
 * roomId -> [{ registrationId, name, held? }]: the people in each room in the
 * order they were given it, then the beds held for somebody by name. A held
 * bed is keyed "hold:<id>", so the lists keep it on its own line too.
 */
export function guestsByRoom(guests, holds = []) {
  const out = new Map();
  const add = (roomId, entry) => {
    if (!out.has(roomId)) out.set(roomId, []);
    out.get(roomId).push(entry);
  };
  guests.forEach((g) => add(g.room_id, { registrationId: g.registration_id, name: g.registration.attendee_name }));
  holds.forEach((h) => add(h.room_id, { registrationId: `hold:${h.id}`, name: holdName(h), held: true }));
  return out;
}

/** How many beds each room has taken: its guests and its held beds. */
export function bedsTaken(guests, holds = []) {
  const out = new Map();
  [...guests, ...holds].forEach((x) => out.set(x.room_id, (out.get(x.room_id) || 0) + 1));
  return out;
}

// Everybody on the event who is not cancelled or in the Recycle Bin, and
// whether they paid for a bed - the same rule the room desk uses.
const PEOPLE_FIELDS = 'id, attendee_name, church_name, status, addons, deleted_at, representative, registration_type, price_tier, amount, amount_paid';

export async function loadPeople(eventId) {
  const read = (fields) => supabaseAdmin
    .from('event_registrations')
    .select(fields)
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .limit(5000);
  const [first, { data: addons }] = await Promise.all([
    read(`${PEOPLE_FIELDS}, exempt_note, exempt_amount, exempt_cover, exempted_at`),
    supabaseAdmin.from('event_addons').select('id, question, fee').eq('event_id', eventId),
  ]);
  // Before registration_exemption.sql has run: nobody is exempted.
  const { data: regs, error } = first.error && /exempt/i.test(first.error.message || '') ? await read(PEOPLE_FIELDS) : first;
  if (error) throw error;
  return (regs || []).map((r) => {
    const ent = roomEntitlement(r.addons, addons || []);
    return {
      id: r.id,
      name: r.attendee_name || '',
      church: r.church_name || '',
      status: r.status,
      entitled: ent.ok,
      why: ent.ok ? '' : ent.why,
      representative: r.representative || '',
      bulk: r.registration_type === 'bulk',
      tier: r.price_tier || '',
      due: Math.max(0, (Number(r.amount) || 0) - (Number(r.amount_paid) || 0)),
      paid: Number(r.amount_paid) || 0,
      // The registration fee alone - what an exemption is worth.
      fee: registrationFeeOf(r),
      // Serving at the event: "Usher", what it waived, and what it can still
      // pay for (an extra added later).
      exempt: r.exempted_at
        ? { note: r.exempt_note || '', waived: Number(r.exempt_amount) || 0, credit: exemptCreditLeft(r) }
        : null,
    };
  });
}
