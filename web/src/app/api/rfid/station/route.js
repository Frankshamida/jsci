import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeUid, isPlausibleUid } from '@/lib/rfid';
import { resolveEventCard } from '@/lib/rfidEventCard';
import { cached } from '@/lib/serverCache';
import {
  findEventActor, canWorkEvent, isEventManager, isCommitteeMember, committeeEventIds, staffDeniedMessage,
} from '@/lib/eventCommittee';

// The name screens as scanning stations of their own: a card tapped on the
// reader plugged into the TV at the door (/rfid-chekin-display) or at the
// Meals Counter (/rfid-meals-display) is answered there, with nobody having
// to open the Admin dashboard's dialogs. Both ways work side by side.
//
// Only somebody who may work the event scans: an Admin, a Super Admin, or an
// Event Committee member assigned to it - the same rule as every committee
// route (lib/eventCommittee.js). The screen asks with the account signed in
// on that device.

// Settled registrations - the three the door accepts.
const VERIFIED_STATUSES = ['registered', 'payment_verified', 'paid_pending_turnover'];
// First and last name too: the screen draws their ID front with them.
const REG_FIELDS = 'id, event_id, user_id, attendee_name, attendee_firstname, attendee_lastname, church_name, status';
const MEALS = ['lunch', 'dinner'];

// The account behind a station, asked on every tap - so kept a minute.
const actorFor = (id) => cached(`station:actor:${id}`, 60_000, () => findEventActor(id));

// GET /api/rfid/station?userId=..
//   May this account scan here, and for which events: the station's own
//   picker, each event with its days so the screen can open on today's.
export async function GET(request) {
  try {
    const userId = new URL(request.url).searchParams.get('userId');
    if (!userId) return NextResponse.json({ success: false, code: 'SIGNED_OUT', message: 'Nobody is signed in on this device.' }, { status: 400 });

    const actor = await findEventActor(userId);
    if (!actor || actor.is_active === false) {
      return NextResponse.json({ success: false, code: 'SIGNED_OUT', message: staffDeniedMessage(actor) }, { status: 403 });
    }
    const manager = isEventManager(actor);
    if (!manager && !isCommitteeMember(actor)) {
      return NextResponse.json({ success: false, code: 'NOT_STAFF', message: staffDeniedMessage(actor) }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from('events')
      .select('id, title, event_date, end_date, location, loc_city, image_url, event_days(*)')
      .eq('is_active', true)
      .eq('is_published', true)
      .order('event_date', { ascending: false })
      .limit(60);
    if (error) throw error;

    // A committee member sees the events they are assigned to; none listed
    // means all of them (see committeeEventIds).
    const scope = manager ? null : committeeEventIds(actor);
    const events = (data || []).filter((e) => !scope || scope.includes(String(e.id)));

    return NextResponse.json({
      success: true,
      data: {
        staff: { id: actor.id, name: [actor.firstname, actor.lastname].filter(Boolean).join(' ') || 'Staff' },
        events,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/rfid/station  { uid, eventId, dayNumber, meal, actorId, source }
//   A card at the Meals Counter's screen: who it is, whether they may eat,
//   and the meal recorded - in one round trip, so the line never waits on a
//   second. Written ON CONFLICT DO NOTHING: the write itself says whether the
//   meal was already taken, and two taps of one card can never be two lunches.
//
//   result  'served' | 'already' | 'blocked' (not checked in that day)
//           | 'not_verified' | 'unknown' | 'not_registered' | 'returned'
export async function POST(request) {
  try {
    const body = await request.json();
    const { eventId, actorId, meal } = body;
    const raw = body.uid;
    const dayNumber = Math.max(1, Number(body.dayNumber) || 1);

    if (!eventId) return NextResponse.json({ success: false, message: 'Choose an event first' }, { status: 400 });
    if (!MEALS.includes(meal)) return NextResponse.json({ success: false, message: 'Choose lunch or dinner' }, { status: 400 });
    if (!isPlausibleUid(raw)) {
      return NextResponse.json({ success: false, message: 'That does not look like a card number' }, { status: 400 });
    }

    const actor = actorId ? await actorFor(actorId) : null;
    if (!actor || actor.is_active === false || !canWorkEvent(actor, eventId)) {
      return NextResponse.json({ success: false, code: 'NOT_STAFF', message: staffDeniedMessage(actor) }, { status: 403 });
    }

    const uid = normalizeUid(raw);
    const found = await resolveEventCard(eventId, raw, REG_FIELDS);
    const reg = found.registration;
    if (!reg) {
      return NextResponse.json({
        success: true, result: found.result || 'unknown', uid,
        message: found.message || 'This card is not linked to anyone at this event yet.',
      });
    }
    if (!VERIFIED_STATUSES.includes(reg.status)) {
      return NextResponse.json({
        success: true, result: 'not_verified', uid, registration: reg,
        message: `${reg.attendee_name} is not verified yet (${String(reg.status || '').replace(/_/g, ' ')}).`,
      });
    }

    // A meal needs them here THAT day - the same rule as /api/events/claims.
    const { data: here, error: hereError } = await supabaseAdmin
      .from('event_day_attendance')
      .select('day_number')
      .eq('registration_id', reg.id)
      .eq('day_number', dayNumber)
      .limit(1);
    if (hereError) {
      throw new Error(/event_day_attendance/i.test(hereError.message || '')
        ? 'Per-day attendance is not set up yet — run supabase/migrations/event_day_attendance.sql.'
        : hereError.message);
    }
    if (!here || here.length === 0) {
      return NextResponse.json({
        success: true, result: 'blocked', uid, registration: reg,
        message: `${reg.attendee_name} is not checked in for Day ${dayNumber} yet — check them in first.`,
      });
    }

    const { data: wrote, error: claimError } = await supabaseAdmin
      .from('event_claims')
      .upsert([{
        registration_id: reg.id,
        event_id: eventId,
        kind: meal,
        day_number: dayNumber,
        claimed_by: actor.id,
        claimed_at: new Date().toISOString(),
        items: [],
      }], { onConflict: 'registration_id,kind,day_number', ignoreDuplicates: true })
      .select('claimed_at');
    if (claimError) throw claimError;

    if (wrote && wrote.length > 0) {
      return NextResponse.json({
        success: true, result: 'served', uid, registration: reg, claimedAt: wrote[0].claimed_at,
        message: `Day ${dayNumber} ${meal} given to ${reg.attendee_name}`,
      });
    }

    // Already on the record: when, so the screen can say so.
    const { data: had } = await supabaseAdmin
      .from('event_claims')
      .select('claimed_at')
      .eq('registration_id', reg.id)
      .eq('kind', meal)
      .eq('day_number', dayNumber)
      .maybeSingle();
    return NextResponse.json({
      success: true, result: 'already', uid, registration: reg, claimedAt: had?.claimed_at || null,
      message: `${reg.attendee_name} already had Day ${dayNumber} ${meal}.`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
