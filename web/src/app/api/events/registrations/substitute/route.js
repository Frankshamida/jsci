import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// POST /api/events/registrations/substitute
//   { actorId, registrationId, firstname, lastname, verifierName? }
//
// Somebody else comes in place of the person registered. The registration
// takes the substitute's name; the registered name is kept in
// original_attendee_name (the first time only). Giving the registered name
// back - by name, or with { restore: true } - clears the substitute fields.
// See supabase/migrations/registration_substitutes.sql.

export const dynamic = 'force-dynamic';

const clean = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);
const cap = (v) => clean(v).replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const key = (v) => clean(v).toLowerCase();
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'Admin';
const MIGRATION_HINT = 'Run supabase/migrations/registration_substitutes.sql first.';

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await findEventActor(body.actorId);
    if (!isEventManager(actor)) {
      return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can substitute an attendee.' }, { status: 403 });
    }
    if (!body.registrationId) return NextResponse.json({ success: false, message: 'registrationId required' }, { status: 400 });

    const { data: reg, error: readError } = await supabaseAdmin
      .from('event_registrations')
      .select('id, attendee_name, attendee_firstname, attendee_lastname, original_attendee_name, status')
      .eq('id', body.registrationId)
      .maybeSingle();
    if (readError) {
      if (/original_attendee_name/i.test(readError.message || '')) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw readError;
    }
    if (!reg) return NextResponse.json({ success: false, message: 'Registration not found.' }, { status: 404 });
    if (reg.status === 'cancelled') return NextResponse.json({ success: false, message: 'A cancelled registration cannot be substituted.' }, { status: 400 });

    const original = reg.original_attendee_name || reg.attendee_name;
    let patch;
    let firstname;
    let lastname;
    if (body.restore) {
      if (!reg.original_attendee_name) return NextResponse.json({ success: false, message: 'This registration has no substitute.' }, { status: 400 });
      const words = clean(reg.original_attendee_name).split(' ');
      lastname = words.length > 1 ? words.pop() : '';
      firstname = words.join(' ');
    } else {
      firstname = cap(body.firstname);
      lastname = cap(body.lastname);
      if (!firstname || !lastname) return NextResponse.json({ success: false, message: 'Enter the substitute’s first name and last name.' }, { status: 400 });
    }
    const full = body.restore ? clean(reg.original_attendee_name) : `${firstname} ${lastname}`;
    if (!body.restore && key(full) === key(reg.attendee_name)) {
      return NextResponse.json({ success: false, message: 'That is already the name on this registration.' }, { status: 400 });
    }

    // Back to the registered name: no longer a substitute at all.
    if (key(full) === key(original)) {
      patch = {
        attendee_name: original,
        ...(body.restore ? {} : { attendee_firstname: firstname, attendee_lastname: lastname }),
        original_attendee_name: null,
        substituted_at: null,
        substituted_by: null,
        substituted_by_name: null,
      };
    } else {
      patch = {
        attendee_name: full,
        attendee_firstname: firstname,
        attendee_lastname: lastname,
        original_attendee_name: original,
        substituted_at: new Date().toISOString(),
        substituted_by: actor.id,
        substituted_by_name: clean(body.verifierName) || nameOf(actor),
      };
    }

    const { data, error } = await supabaseAdmin
      .from('event_registrations').update(patch).eq('id', reg.id).select('*').single();
    if (error) {
      if (/original_attendee_name|substituted_/i.test(error.message || '')) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }
    return NextResponse.json({ success: true, data, previousName: reg.attendee_name, originalName: original });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
