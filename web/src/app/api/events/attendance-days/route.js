import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Attendance, per day of the event.
//
// See supabase/migrations/event_day_attendance.sql for why this is a row per
// day rather than a boolean: a three-day conference has to answer "did they
// come on Day 2", and event_registrations.attended cannot.
//
// That boolean is still maintained here, meaning "came on at least one day",
// because reports, exports and older screens read it. Both are written in one
// place - this file - so they cannot drift.

const VERIFIED_STATUSES = ['registered', 'payment_verified', 'paid_pending_turnover'];

// Whatever the day rows now say, said again on the registration. Called after
// every write rather than computed on read, so the boolean is never a guess.
async function syncAttendedFlag(registrationId) {
  const { data: days } = await supabaseAdmin
    .from('event_day_attendance')
    .select('attended_at')
    .eq('registration_id', registrationId)
    .order('attended_at', { ascending: true });

  const first = (days || [])[0];
  await supabaseAdmin
    .from('event_registrations')
    .update({
      attended: !!first,
      // The FIRST arrival, not the latest. "When did they get here" is asked
      // of the day they turned up, and a Day 2 tap must not rewrite Day 1.
      attended_at: first ? first.attended_at : null,
    })
    .eq('id', registrationId);

  return (days || []).length;
}

// GET /api/events/attendance-days?eventId=..
//   The whole grid in one request: who came, on which days.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('event_day_attendance')
      .select('registration_id, day_number, attended_at, attended_by')
      .eq('event_id', eventId);
    if (error) throw error;

    // { registrationId: { '1': { attended_at, attended_by }, ... } }
    const byReg = {};
    (data || []).forEach((d) => {
      if (!byReg[d.registration_id]) byReg[d.registration_id] = {};
      byReg[d.registration_id][String(d.day_number)] = {
        attended_at: d.attended_at,
        attended_by: d.attended_by,
      };
    });

    return NextResponse.json({ success: true, data: byReg });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/events/attendance-days
//   { eventId, registrationId, dayNumber, attended, actorId }
export async function POST(request) {
  try {
    const body = await request.json();
    const { eventId, registrationId, actorId } = body;
    const dayNumber = Number(body.dayNumber) || 0;
    const attended = body.attended !== false;

    if (!eventId || !registrationId) {
      return NextResponse.json({ success: false, message: 'eventId and registrationId are required' }, { status: 400 });
    }
    if (dayNumber < 1) {
      return NextResponse.json({ success: false, message: 'Which day? Days are numbered from 1.' }, { status: 400 });
    }

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
    // A registration whose payment was un-verified after a card was handed
    // out must not walk in on the strength of the card.
    if (attended && !VERIFIED_STATUSES.includes(reg.status)) {
      return NextResponse.json({
        success: false,
        message: `${reg.attendee_name} is not verified yet — verify the registration first.`,
      }, { status: 400 });
    }

    if (!attended) {
      const { error } = await supabaseAdmin
        .from('event_day_attendance')
        .delete()
        .eq('registration_id', registrationId)
        .eq('day_number', dayNumber);
      if (error) throw error;
      await syncAttendedFlag(registrationId);
      return NextResponse.json({
        success: true, attended: false, dayNumber,
        message: `${reg.attendee_name} unmarked for Day ${dayNumber}`,
      });
    }

    // Already here today. Not an error - people tap twice - but the time they
    // actually arrived must survive it, so nothing is written.
    const { data: existing } = await supabaseAdmin
      .from('event_day_attendance')
      .select('attended_at')
      .eq('registration_id', registrationId)
      .eq('day_number', dayNumber)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        success: true,
        attended: true,
        already: true,
        dayNumber,
        day: { attended_at: existing.attended_at },
        message: `${reg.attendee_name} is already checked in for Day ${dayNumber}`,
      });
    }

    const { data, error } = await supabaseAdmin
      .from('event_day_attendance')
      .insert([{
        registration_id: registrationId,
        event_id: eventId,
        day_number: dayNumber,
        attended_by: actorId || null,
      }])
      .select('attended_at, attended_by')
      .single();
    if (error) throw error;

    await syncAttendedFlag(registrationId);

    return NextResponse.json({
      success: true,
      attended: true,
      already: false,
      dayNumber,
      day: { attended_at: data?.attended_at, attended_by: data?.attended_by },
      message: `${reg.attendee_name} checked in for Day ${dayNumber}`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
