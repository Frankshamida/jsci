import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// What each attendee has collected at an event: the kit, and lunch/dinner on
// each day. See supabase/migrations/event_claims.sql for why this is a row per
// claim rather than columns on the registration.
//
// The row existing IS the claim, so this route only ever inserts or deletes.
// There is no "unclaimed" row to write, and nothing to keep in step.

const KINDS = ['kit', 'lunch', 'dinner'];

// The key the client indexes claims by. Built in one place because both sides
// have to agree on it exactly, and "kit" against "kit-0" is the kind of
// mismatch that shows up as a checkbox that silently will not tick.
const claimKey = (kind, dayNumber) => `${kind}-${Number(dayNumber) || 0}`;

// GET /api/events/claims?eventId=..
//   Everything claimed at this event, grouped by registration. One request
//   for the whole grid - a table of forty attendees across two days is 200
//   checkboxes, and asking per box would be 200 round trips.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('event_claims')
      .select('registration_id, kind, day_number, claimed_at, claimed_by, items')
      .eq('event_id', eventId);
    if (error) throw error;

    // { registrationId: { 'lunch-1': { claimed_at, claimed_by }, ... } }
    const byReg = {};
    (data || []).forEach((c) => {
      if (!byReg[c.registration_id]) byReg[c.registration_id] = {};
      byReg[c.registration_id][claimKey(c.kind, c.day_number)] = {
        claimed_at: c.claimed_at,
        claimed_by: c.claimed_by,
        items: Array.isArray(c.items) ? c.items : [],
      };
    });

    return NextResponse.json({ success: true, data: byReg });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/events/claims  { eventId, registrationId, kind, dayNumber, claimed, actorId }
//   Hand something over, or take back a mis-tick.
export async function POST(request) {
  try {
    const body = await request.json();
    const { eventId, registrationId, kind, actorId } = body;
    const dayNumber = Number(body.dayNumber) || 0;
    const claimed = body.claimed !== false;
    // Which pieces of the kit actually changed hands. Names, trimmed and
    // de-duplicated; only meaningful on a kit claim. Capped because this is a
    // list a person types into an event form, not an import.
    const items = Array.isArray(body.items)
      ? [...new Set(body.items.map((i) => String(i || '').trim()).filter(Boolean))].slice(0, 50)
      : [];

    if (!eventId || !registrationId) {
      return NextResponse.json({ success: false, message: 'eventId and registrationId are required' }, { status: 400 });
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ success: false, message: 'Unknown claim type' }, { status: 400 });
    }
    // A meal belongs to a day and the kit does not. Letting those cross would
    // put a lunch on day 0, where nothing looks for it.
    if (kind === 'kit' && dayNumber !== 0) {
      return NextResponse.json({ success: false, message: 'The kit is not tied to a day' }, { status: 400 });
    }
    if (kind !== 'kit' && dayNumber < 1) {
      return NextResponse.json({ success: false, message: 'A meal needs a day' }, { status: 400 });
    }

    // Only a settled registration collects anything. Somebody still waiting
    // on payment verification is not owed a kit or a meal yet, and the desk
    // being able to hand one over anyway is how an event loses track of both.
    const { data: reg, error: regError } = await supabaseAdmin
      .from('event_registrations')
      .select('id, event_id, status, attendee_name')
      .eq('id', registrationId)
      .single();
    if (regError || !reg) {
      return NextResponse.json({ success: false, message: 'That registration could not be found' }, { status: 404 });
    }
    if (reg.event_id !== eventId) {
      return NextResponse.json({ success: false, message: 'That registration is for a different event' }, { status: 400 });
    }
    if (claimed && !['registered', 'payment_verified', 'paid_pending_turnover'].includes(reg.status)) {
      return NextResponse.json({
        success: false,
        message: `${reg.attendee_name} is not verified yet — verify the registration first.`,
      }, { status: 400 });
    }

    // Nothing is collected by somebody who has not turned up.
    //
    // Enforced here and not only in the dialog, because the dialog is one of
    // several ways in and this is the rule that stops a kit walking out for
    // somebody who never came. The day it checks differs by kind, and the
    // difference is the point of per-day attendance:
    //
    //   a meal  needs them here THAT day - Day 2 lunch is not owed to
    //           somebody who only came on Day 1
    //   the kit needs them here at all - it is handed over once, on whichever
    //           day they first arrive
    if (claimed) {
      const dayQuery = supabaseAdmin
        .from('event_day_attendance')
        .select('day_number')
        .eq('registration_id', registrationId);

      const { data: days, error: daysError } = kind === 'kit'
        ? await dayQuery
        : await dayQuery.eq('day_number', dayNumber);

      // Fail closed, but say which failure it is. A missing table refuses
      // everybody, and blaming the attendee for that would send somebody to
      // the door to check in a person who is already standing there.
      if (daysError) {
        return NextResponse.json({
          success: false,
          message: /event_day_attendance/i.test(daysError.message || '')
            ? 'Per-day attendance is not set up yet — run supabase/migrations/event_day_attendance.sql, then try again.'
            : daysError.message,
        }, { status: 500 });
      }

      if (!days || days.length === 0) {
        return NextResponse.json({
          success: false,
          message: kind === 'kit'
            ? `${reg.attendee_name} has not been checked in yet — check them in at the door first.`
            : `${reg.attendee_name} is not checked in for Day ${dayNumber} yet — check them in first.`,
        }, { status: 400 });
      }
    }

    if (!claimed) {
      const { error } = await supabaseAdmin
        .from('event_claims')
        .delete()
        .eq('registration_id', registrationId)
        .eq('kind', kind)
        .eq('day_number', dayNumber);
      if (error) throw error;
      return NextResponse.json({ success: true, claimed: false, key: claimKey(kind, dayNumber) });
    }

    // upsert, not insert: two people at the same counter can tick the same box
    // at the same moment, and the second one should be a no-op rather than a
    // unique-violation shown to somebody holding a tray.
    const { data, error } = await supabaseAdmin
      .from('event_claims')
      .upsert(
        [{
          registration_id: registrationId,
          event_id: eventId,
          kind,
          day_number: dayNumber,
          claimed_by: actorId || null,
          claimed_at: new Date().toISOString(),
          items: kind === 'kit' ? items : [],
        }],
        { onConflict: 'registration_id,kind,day_number', ignoreDuplicates: false },
      )
      .select('claimed_at, claimed_by, items')
      .single();
    if (error) throw error;

    return NextResponse.json({
      success: true,
      claimed: true,
      key: claimKey(kind, dayNumber),
      claim: {
        claimed_at: data?.claimed_at,
        claimed_by: data?.claimed_by,
        items: Array.isArray(data?.items) ? data.items : [],
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
