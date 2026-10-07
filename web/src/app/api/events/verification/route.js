import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPlausibleUid, normalizeUid, uidCandidates } from '@/lib/rfid';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// GET /api/events/verification?eventId=..&uid=..&actorId=..
//
// Registration Verification starts with the person on the desk tapping their
// own staff card (rfid_cards). This says whether that card's holder is the one
// assigned to do it for this event:
//
//   - a Registration Verifier added under Events RFID (registration_verifiers), or
//   - an Admin or Super Admin holding the card, or
//   - a committee member whose assignment for this event
//     (committee_assignments.roles) includes Registration / Verification.
//
// POST { eventId, actorId, password } is a TEMPORARY way in for testing,
// without a card: VERIFY_TEST_PASSWORD, or Pass@123! when that is not set.
// Remove it (and the button) once the cards are handed out.
//
// Only an Admin or Super Admin can open verification (actorId), so a card's
// holder is never told to anybody else. Every tap is logged in rfid_scans.

export const dynamic = 'force-dynamic';

const DUTY = /registration|verif/i;
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || u?.email || 'Staff';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const raw = searchParams.get('uid') || '';
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    if (!isPlausibleUid(raw)) return NextResponse.json({ success: false, message: 'That does not look like a card number.' }, { status: 400 });
    if (!isEventManager(await findEventActor(searchParams.get('actorId')))) {
      return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can start Registration Verification.' }, { status: 403 });
    }

    const uid = normalizeUid(raw);

    // A Registration Verifier card, added under Events RFID.
    const { data: verifiers } = await supabaseAdmin
      .from('registration_verifiers')
      .select('id, firstname, lastname, is_active')
      .in('uid', uidCandidates(raw))
      .limit(1);
    const verifier = verifiers?.[0];
    if (verifier) {
      const name = `${verifier.firstname} ${verifier.lastname}`.trim();
      if (!verifier.is_active) {
        return NextResponse.json({ success: true, ok: false, uid, message: `${name} is switched off as a verifier. Turn them back on under Events RFID.` });
      }
      return NextResponse.json({ success: true, ok: true, uid, staff: { id: verifier.id, name, role: 'Verifier', duty: 'Registration Verifier', picture: null } });
    }

    const { data: cards, error } = await supabaseAdmin
      .from('rfid_cards')
      .select('id, uid, label, user_id, is_active, users:user_id (id, firstname, lastname, email, role, is_active, profile_picture)')
      .in('uid', uidCandidates(raw))
      .limit(1);
    if (error) throw error;
    const card = cards?.[0] || null;
    const user = card?.users || null;

    const answer = (ok, message, extra = {}) => {
      // The tap is on record whatever the answer.
      supabaseAdmin.from('rfid_scans').insert([{
        uid, raw_uid: String(raw).slice(0, 128), user_id: card?.user_id || null,
        result: !card ? 'unknown' : (card.is_active ? 'matched' : 'inactive'),
        source: 'keyboard', event_id: eventId,
      }]).then(() => {}, () => {});
      return NextResponse.json({ success: true, ok, message, uid, ...extra });
    };

    if (!card || !user) return answer(false, 'This card is not assigned to any staff member. Assign it under Events RFID first.');
    if (!card.is_active) return answer(false, `${nameOf(user)}'s card is switched off.`);
    if (user.is_active === false) return answer(false, `${nameOf(user)}'s account is deactivated.`);

    const staff = { id: user.id, name: nameOf(user), role: user.role, picture: user.profile_picture || null };
    // A Super Admin's own access card (Events RFID -> Super Admin Access) says
    // so on the logs, where a password sign-in says "Test sign-in".
    if (isEventManager(user)) {
      const duty = card.label === 'Super Admin Access' && user.role === 'Super Admin' ? 'Super Admin Access card' : user.role;
      return answer(true, '', { staff: { ...staff, duty } });
    }

    // Committee: assigned to this event with a registration / verification duty.
    const { data: assignment } = await supabaseAdmin
      .from('committee_assignments')
      .select('roles')
      .eq('user_id', user.id)
      .eq('event_id', eventId)
      .maybeSingle();
    const roles = Array.isArray(assignment?.roles) ? assignment.roles.map(String) : [];
    const duty = roles.find((r) => DUTY.test(r));
    if (!duty) {
      return answer(false, `${staff.name} is not assigned to Registration for this event. Give them the Registration role in the event's committee assignments.`);
    }
    return answer(true, '', { staff: { ...staff, duty } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ---- TEMPORARY: start verification with a password, for testing ----
const TEST_PASSWORD = process.env.VERIFY_TEST_PASSWORD || 'Pass@123!';

export async function POST(request) {
  try {
    const { eventId, actorId, password } = await request.json();
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const actor = await findEventActor(actorId);
    if (!isEventManager(actor)) {
      return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can start Registration Verification.' }, { status: 403 });
    }
    if (String(password || '') !== TEST_PASSWORD) {
      return NextResponse.json({ success: true, ok: false, message: 'Wrong password.' });
    }
    return NextResponse.json({
      success: true,
      ok: true,
      staff: { id: actor.id, name: nameOf(actor), role: actor.role, duty: 'Test sign-in (password)', picture: actor.profile_picture || null },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
