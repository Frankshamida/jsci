import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';
import { splitReturnedLinks, releaseLinks } from '@/lib/rfidEventCard';

// Cards handed back at the end of an event. See
// supabase/migrations/rfid_card_returns.sql.
//
// Returning a card logs the return - who, which card, when - and lets go of
// the rfid_event_cards link, so the card is free at once: for somebody else at
// this event as much as for the next one, and a tap no longer answers to the
// person who returned it. The log row is the record of whose it was.
// Reverting drops the log row and puts the same card back on the same
// attendee, as long as nobody has been given it since.

const MIGRATION_HINT = 'Run supabase/migrations/rfid_card_returns.sql first.';
const missingTable = (err) => /rfid_card_returns/i.test(err?.message || '');

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  if (!isEventManager(actor)) {
    return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can do this.' }, { status: 403 });
  }
  return null;
}

// GET /api/rfid/card-returns?eventId=..   the log, newest first
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('rfid_card_returns')
      .select('id, event_id, registration_id, uid, returned_by, returned_at, event_registrations(attendee_name, church_name)')
      .eq('event_id', eventId)
      .order('returned_at', { ascending: false });
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }

    const rows = (data || []).map(({ event_registrations: reg, ...r }) => ({
      ...r,
      attendee_name: reg?.attendee_name || '',
      church_name: reg?.church_name || '',
    }));
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/rfid/card-returns  { registrationId, eventId, actorId }
//   The attendee handed their card back.
export async function POST(request) {
  try {
    const { registrationId, eventId, actorId } = await request.json();
    if (!registrationId || !eventId) {
      return NextResponse.json({ success: false, message: 'registrationId and eventId required' }, { status: 400 });
    }
    const denied = await requireManager(actorId);
    if (denied) return denied;

    const { data: link } = await supabaseAdmin
      .from('rfid_event_cards')
      .select('id, registration_id, uid, assigned_at')
      .eq('registration_id', registrationId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ success: false, message: 'This attendee has no card to return.' }, { status: 409 });
    }
    // Returned since it was given to them (a link kept by an older return).
    const { returned: earlier } = await splitReturnedLinks([link]);
    if (earlier.length) {
      await releaseLinks(earlier);
      return NextResponse.json({ success: false, already: true, message: 'This card is already marked as returned.' }, { status: 409 });
    }

    const { data: row, error } = await supabaseAdmin
      .from('rfid_card_returns')
      .insert({ event_id: eventId, registration_id: registrationId, uid: link.uid, returned_by: actorId || null })
      .select('id, event_id, registration_id, uid, returned_by, returned_at, event_registrations(attendee_name, church_name)')
      .single();
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }

    // Free again. The return row is logged first, so a failure here leaves a
    // card that still counts as handed back (splitReturnedLinks), never one
    // that is let go with no record of whose it was.
    await releaseLinks([link]);

    const { event_registrations: reg, ...rest } = row;
    return NextResponse.json({
      success: true,
      data: { ...rest, attendee_name: reg?.attendee_name || '', church_name: reg?.church_name || '' },
      message: `${reg?.attendee_name || 'The attendee'}'s card marked as returned - it is free for somebody else`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT /api/rfid/card-returns  { id, actorId }
//   Revert a return: the card is theirs and out again, not back at the desk.
export async function PUT(request) {
  try {
    const { id, actorId } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const denied = await requireManager(actorId);
    if (denied) return denied;

    const { data: ret } = await supabaseAdmin
      .from('rfid_card_returns')
      .select('id, event_id, registration_id, uid')
      .eq('id', id)
      .maybeSingle();
    if (!ret) return NextResponse.json({ success: false, message: 'That return is no longer on record.' }, { status: 404 });

    const { data: own } = await supabaseAdmin
      .from('rfid_event_cards').select('*').eq('registration_id', ret.registration_id).maybeSingle();
    // Still linked (an older return kept the link): only the log row goes.
    if (own && own.uid === ret.uid) {
      const { error: delErr } = await supabaseAdmin.from('rfid_card_returns').delete().eq('id', ret.id);
      if (delErr) throw delErr;
      return NextResponse.json({ success: true, data: own, message: 'Marked as not returned' });
    }
    if (own) {
      return NextResponse.json({ success: false, message: 'This attendee already holds another card. Remove it first.' }, { status: 409 });
    }
    // Given to somebody else since - unless they have handed it back too.
    const { data: others } = await supabaseAdmin
      .from('rfid_event_cards').select('*').eq('event_id', ret.event_id).eq('uid', ret.uid);
    const { held, returned } = await splitReturnedLinks(others);
    const taken = held[0] || null;
    if (taken) {
      const { data: other } = await supabaseAdmin
        .from('event_registrations').select('attendee_name').eq('id', taken.registration_id).maybeSingle();
      return NextResponse.json({
        success: false,
        message: `That card has since been given to ${other?.attendee_name || 'someone else'}.`,
      }, { status: 409 });
    }

    await releaseLinks(returned);
    const { data: link, error } = await supabaseAdmin
      .from('rfid_event_cards')
      .insert({ uid: ret.uid, registration_id: ret.registration_id, event_id: ret.event_id, assigned_by: actorId || null })
      .select()
      .single();
    if (error) throw error;

    await supabaseAdmin.from('rfid_card_returns').delete().eq('id', ret.id);
    return NextResponse.json({ success: true, data: link, message: 'Card assigned back' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE /api/rfid/card-returns?id=..&actorId=..   remove a log row only
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const denied = await requireManager(searchParams.get('actorId'));
    if (denied) return denied;

    const { error } = await supabaseAdmin.from('rfid_card_returns').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Return record deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
