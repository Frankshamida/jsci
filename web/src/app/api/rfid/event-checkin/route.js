import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeUid, isPlausibleUid, uidCandidates } from '@/lib/rfid';

// Checking people in at an event door with a card.
//
// The registration is the thing that matters here, not the person: an event
// door is asking "are you on the list", and half the people on an event list
// have no account behind them. See supabase/migrations/rfid_event_checkin.sql.

// A registration is only worth a card once the money is settled. These are
// the two statuses that mean "settled" - 'registered' is what a free event
// produces, 'payment_verified' is what a paid one becomes when staff confirm
// the payment. Everything else is still waiting on somebody.
const VERIFIED_STATUSES = ['registered', 'payment_verified'];

const REG_FIELDS = 'id, event_id, user_id, attendee_name, attendee_mobile, church_name, status, attended, attended_at, amount_paid, registration_type';

// One card, at one event, to the registration it belongs to.
//
// Lifted out of the check-in POST because two different desks ask the same
// question and want different things done about the answer: the door checks
// them in, the kit and meal counters only need to know who is standing there.
// Two copies of this two-step lookup would drift, and a card that works at
// the door but not at the meal counter is a miserable thing to explain.
//
// Step one is a card handed out for THIS event. Step two is the member's own
// card, then whether that member is on this event's list.
async function resolveCard(eventId, raw) {
  const candidates = uidCandidates(raw);

  const { data: link } = await supabaseAdmin
    .from('rfid_event_cards')
    .select('*')
    .eq('event_id', eventId)
    .in('uid', candidates)
    .maybeSingle();

  if (link) {
    const { data } = await supabaseAdmin
      .from('event_registrations')
      .select(REG_FIELDS)
      .eq('id', link.registration_id)
      .maybeSingle();
    return { registration: data || null, result: data ? 'matched' : 'unknown' };
  }

  const { data: memberCard } = await supabaseAdmin
    .from('rfid_cards')
    .select('*, users:user_id (id, firstname, lastname)')
    .in('uid', candidates)
    .maybeSingle();

  if (memberCard && memberCard.is_active) {
    const { data } = await supabaseAdmin
      .from('event_registrations')
      .select(REG_FIELDS)
      .eq('event_id', eventId)
      .eq('user_id', memberCard.user_id)
      .in('status', VERIFIED_STATUSES)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return { registration: data, result: 'matched' };

    // The card is known and the person is known - they are simply not on
    // this event's list. Saying which of those it is saves the desk from
    // wondering whether the card is broken.
    const who = memberCard.users
      ? `${memberCard.users.firstname || ''} ${memberCard.users.lastname || ''}`.trim()
      : 'That member';
    return {
      registration: null,
      result: 'not_registered',
      message: `${who} has no verified registration for this event.`,
    };
  }

  return {
    registration: null,
    result: 'unknown',
    message: 'This card is not linked to anyone at this event yet.',
  };
}

// GET /api/rfid/event-checkin?overview=1
//   One row per event: how many are verified, how many hold a card, how many
//   are through the door. This is what the event cards on the RFID screen are
//   counting, and it is one request rather than one per event - a church with
//   forty events on file would otherwise make forty round trips to draw a
//   grid nobody has clicked on yet.
async function eventOverview() {
  const { data: events, error: eventsError } = await supabaseAdmin
    .from('events')
    // Only columns the events table actually has - see the POST handler in
    // api/events/route.js for the real shape. Drafts are left out: an event
    // nobody can register for has nobody to hand a card to.
    .select('id, title, event_date, end_date, location, image_url')
    .eq('is_active', true)
    .eq('is_published', true)
    // Newest first. A card desk is nearly always working on the next event
    // or the one running today, not on something from two years ago.
    .order('event_date', { ascending: false });
  if (eventsError) throw eventsError;

  const ids = (events || []).map((e) => e.id);
  if (ids.length === 0) return [];

  // Both tables read whole rather than per event, then counted in memory.
  // Two queries for any number of events.
  const [{ data: regs }, { data: links }] = await Promise.all([
    supabaseAdmin
      .from('event_registrations')
      .select('id, event_id, attended')
      .in('event_id', ids)
      .in('status', VERIFIED_STATUSES)
      .is('deleted_at', null),
    supabaseAdmin
      .from('rfid_event_cards')
      .select('event_id, registration_id')
      .in('event_id', ids),
  ]);

  const counts = new Map(ids.map((id) => [id, { verified: 0, carded: 0, attended: 0 }]));
  (regs || []).forEach((r) => {
    const c = counts.get(r.event_id);
    if (!c) return;
    c.verified += 1;
    if (r.attended) c.attended += 1;
  });
  (links || []).forEach((l) => {
    const c = counts.get(l.event_id);
    if (c) c.carded += 1;
  });

  return (events || []).map((e) => ({ ...e, summary: counts.get(e.id) }));
}

// GET /api/rfid/event-checkin?eventId=..
//   The door list: every verified registration for the event, each with the
//   card tied to it if it has one.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get('overview')) {
      return NextResponse.json({ success: true, data: await eventOverview() });
    }

    // ?eventId=..&uid=..  Who is this card, without doing anything about it.
    //
    // The kit and meal counters need the name on the card and nothing else:
    // handing somebody a tote bag is not walking through the door, and a tap
    // at the merch table must not silently mark them as having arrived.
    const lookupUid = searchParams.get('uid');
    if (lookupUid) {
      const forEvent = searchParams.get('eventId');
      if (!forEvent) {
        return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
      }
      if (!isPlausibleUid(lookupUid)) {
        return NextResponse.json({ success: false, message: 'That does not look like a card number' }, { status: 400 });
      }

      const found = await resolveCard(forEvent, lookupUid);
      const uid = normalizeUid(lookupUid);

      if (!found.registration) {
        return NextResponse.json({
          success: true, result: found.result, uid,
          message: found.message || 'This card is not linked to anyone at this event yet.',
        });
      }
      // A registration whose payment was un-verified after a card was handed
      // out must not collect anything on the strength of the card.
      if (!VERIFIED_STATUSES.includes(found.registration.status)) {
        return NextResponse.json({
          success: true, result: 'not_verified', uid, registration: found.registration,
          message: `${found.registration.attendee_name} is not verified yet (${found.registration.status.replace(/_/g, ' ')}).`,
        });
      }

      // What they have already collected, so the counter cannot hand out a
      // second one and can see at a glance what is still owed.
      const { data: claims } = await supabaseAdmin
        .from('event_claims')
        .select('kind, day_number, claimed_at, items')
        .eq('registration_id', found.registration.id);

      // Which days they have actually turned up for. The kit and meal
      // counters refuse anybody who has not arrived, so they need this in
      // the same round trip - a second request would be a second chance to
      // be out of date while somebody waits at a counter.
      const { data: days } = await supabaseAdmin
        .from('event_day_attendance')
        .select('day_number, attended_at')
        .eq('registration_id', found.registration.id);

      return NextResponse.json({
        success: true, result: 'matched', uid,
        registration: found.registration,
        claims: claims || [],
        days: days || [],
      });
    }

    const eventId = searchParams.get('eventId');
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    }

    const { data: regs, error } = await supabaseAdmin
      .from('event_registrations')
      .select(REG_FIELDS)
      .eq('event_id', eventId)
      .in('status', VERIFIED_STATUSES)
      .is('deleted_at', null)
      .order('attendee_name', { ascending: true });
    if (error) throw error;

    const { data: links } = await supabaseAdmin
      .from('rfid_event_cards')
      .select('*')
      .eq('event_id', eventId);

    const byReg = new Map((links || []).map((l) => [l.registration_id, l]));
    const data = (regs || []).map((r) => ({ ...r, card: byReg.get(r.id) || null }));

    return NextResponse.json({
      success: true,
      data,
      summary: {
        verified: data.length,
        carded: data.filter((r) => r.card).length,
        attended: data.filter((r) => r.attended).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/rfid/event-checkin  { uid, eventId, actorId }
//   A tap at the door. Resolves the card to a registration and checks it in.
export async function POST(request) {
  try {
    const body = await request.json();
    const { eventId, actorId } = body;
    const raw = body.uid;
    // Which day of the event this tap is for. The desk picks it, because only
    // the desk knows: a door open at 8am on Day 2 is checking people in for
    // Day 2 whatever the server's clock says about timezones, and an event
    // running past midnight would otherwise roll over mid-queue.
    const dayNumber = Math.max(1, Number(body.dayNumber) || 1);

    if (!eventId) return NextResponse.json({ success: false, message: 'Choose an event first' }, { status: 400 });
    if (!isPlausibleUid(raw)) {
      return NextResponse.json({ success: false, message: 'That does not look like a card number' }, { status: 400 });
    }

    const uid = normalizeUid(raw);

    const logScan = async (result, registration) => {
      await supabaseAdmin.from('rfid_scans').insert([{
        uid,
        raw_uid: String(raw).slice(0, 128),
        user_id: registration?.user_id || null,
        registration_id: registration?.id || null,
        event_id: eventId,
        result,
        source: body.source || 'manual',
        scanned_by: actorId || null,
      }]);
    };

    const found = await resolveCard(eventId, raw);
    const registration = found.registration;

    if (!registration) {
      await logScan(found.result, null);
      return NextResponse.json({
        success: true,
        result: found.result,
        uid,
        message: found.message || 'This card is not linked to anyone at this event yet.',
      });
    }

    // A registration whose payment was un-verified after a card was handed out
    // must not walk in on the strength of the card.
    if (!VERIFIED_STATUSES.includes(registration.status)) {
      await logScan('not_verified', registration);
      return NextResponse.json({
        success: true,
        result: 'not_verified',
        uid,
        registration,
        message: `${registration.attendee_name} is not verified yet (${registration.status.replace(/_/g, ' ')}).`,
      });
    }

    // Already through the door FOR THIS DAY. Not an error - people tap twice
    // - but it must not overwrite the time they actually arrived. Note this
    // is now per day: somebody who came on Day 1 taps in again on Day 2 and
    // is checked in, which the old registration-wide boolean refused.
    const { data: sameDay } = await supabaseAdmin
      .from('event_day_attendance')
      .select('attended_at')
      .eq('registration_id', registration.id)
      .eq('day_number', dayNumber)
      .maybeSingle();

    if (sameDay) {
      await logScan('already_in', registration);
      return NextResponse.json({
        success: true,
        result: 'already_in',
        uid,
        dayNumber,
        registration,
        message: `${registration.attendee_name} is already checked in for Day ${dayNumber}.`,
      });
    }

    const { error: dayErr } = await supabaseAdmin
      .from('event_day_attendance')
      .insert([{
        registration_id: registration.id,
        event_id: eventId,
        day_number: dayNumber,
        attended_by: actorId || null,
      }]);
    if (dayErr) throw dayErr;

    // The registration-wide flag still means "came on at least one day", for
    // the reports and screens that read it. Only set on the first arrival, so
    // a Day 2 tap cannot rewrite when they first got here.
    const { data: updated, error: upErr } = await supabaseAdmin
      .from('event_registrations')
      .update(registration.attended
        ? {}
        : { attended: true, attended_at: new Date().toISOString(), attended_by: actorId || null })
      .eq('id', registration.id)
      .select(REG_FIELDS)
      .single();
    if (upErr) throw upErr;

    await logScan('matched', updated);

    return NextResponse.json({
      success: true,
      result: 'checked_in',
      uid,
      registration: updated,
      dayNumber,
      message: `${updated.attendee_name} checked in for Day ${dayNumber}`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT /api/rfid/event-checkin  { uid, registrationId, eventId, actorId }
//   Hand a card to somebody on the list.
export async function PUT(request) {
  try {
    const body = await request.json();
    const { registrationId, eventId, actorId } = body;
    const raw = body.uid;

    if (!registrationId || !eventId) {
      return NextResponse.json({ success: false, message: 'registrationId and eventId required' }, { status: 400 });
    }
    if (!isPlausibleUid(raw)) {
      return NextResponse.json({ success: false, message: 'That does not look like a card number' }, { status: 400 });
    }

    const uid = normalizeUid(raw);

    const { data: reg } = await supabaseAdmin
      .from('event_registrations')
      .select(REG_FIELDS)
      .eq('id', registrationId)
      .maybeSingle();
    if (!reg) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });

    // The whole point of this feature is that a card gets somebody through the
    // door. Giving one to a registration that is not settled would hand out
    // exactly the access the verification step exists to withhold.
    if (!VERIFIED_STATUSES.includes(reg.status)) {
      return NextResponse.json({
        success: false,
        message: `${reg.attendee_name} is not verified yet (${reg.status.replace(/_/g, ' ')}). Verify the registration first.`,
      }, { status: 400 });
    }

    // Is this card already somebody else's at this event?
    const { data: clash } = await supabaseAdmin
      .from('rfid_event_cards')
      .select('*')
      .eq('event_id', eventId)
      .in('uid', uidCandidates(raw))
      .maybeSingle();

    if (clash && clash.registration_id !== registrationId) {
      const { data: other } = await supabaseAdmin
        .from('event_registrations')
        .select('attendee_name')
        .eq('id', clash.registration_id)
        .maybeSingle();
      return NextResponse.json({
        success: false,
        message: `That card is already ${other?.attendee_name || 'someone else'}'s at this event.`,
      }, { status: 409 });
    }

    // upsert on registration_id: handing a replacement card to someone who
    // lost theirs simply moves the link rather than needing an unlink first.
    const { data, error } = await supabaseAdmin
      .from('rfid_event_cards')
      .upsert(
        { uid, registration_id: registrationId, event_id: eventId, assigned_by: actorId || null, assigned_at: new Date().toISOString() },
        { onConflict: 'registration_id' },
      )
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: `Card given to ${reg.attendee_name}` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE /api/rfid/event-checkin?registrationId=..   take the card back
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const registrationId = searchParams.get('registrationId');
    if (!registrationId) {
      return NextResponse.json({ success: false, message: 'registrationId required' }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from('rfid_event_cards')
      .delete()
      .eq('registration_id', registrationId);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Card taken back' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
