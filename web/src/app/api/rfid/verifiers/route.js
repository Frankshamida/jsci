import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPlausibleUid, normalizeUid, uidCandidates } from '@/lib/rfid';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// The Registration Verifiers list under Events RFID - see
// supabase/migrations/registration_verifiers.sql. Admin / Super Admin only.
//
//   GET                                   the list, A to Z by last name
//   POST   { actorId, uid, firstname, lastname }
//   PATCH  { actorId, id, firstname?, lastname?, isActive? }
//   DELETE ?id=..&actorId=..

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/registration_verifiers.sql first.';
const COLUMNS = 'id, uid, firstname, lastname, is_active, created_at, updated_at';

const clean = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);
// First letter of each word up, the rest as typed (so "McDonald" survives).
const titleCase = (v) => clean(v).replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function fail(error) {
  const msg = error?.message || '';
  if (/registration_verifiers/i.test(msg)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
  if (error?.code === '23505') return NextResponse.json({ success: false, message: 'That card already belongs to another verifier.' }, { status: 409 });
  return NextResponse.json({ success: false, message: msg || 'Something went wrong' }, { status: 500 });
}

async function denied(actorId) {
  if (isEventManager(await findEventActor(actorId))) return null;
  return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can manage verifiers.' }, { status: 403 });
}

export async function GET(request) {
  try {
    const no = await denied(new URL(request.url).searchParams.get('actorId'));
    if (no) return no;
    const { data, error } = await supabaseAdmin
      .from('registration_verifiers')
      .select(COLUMNS)
      .order('lastname', { ascending: true })
      .order('firstname', { ascending: true });
    if (error) return fail(error);
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const no = await denied(body.actorId);
    if (no) return no;
    if (!isPlausibleUid(body.uid)) return NextResponse.json({ success: false, message: 'Tap a card first.' }, { status: 400 });
    const firstname = titleCase(body.firstname);
    const lastname = titleCase(body.lastname);
    if (!firstname || !lastname) return NextResponse.json({ success: false, message: 'First name and last name are required.' }, { status: 400 });

    // A card in an attendee's hand at any event is not a verifier's card.
    const { data: attendeeCard } = await supabaseAdmin
      .from('rfid_event_cards').select('id').in('uid', uidCandidates(body.uid)).limit(1);
    if (attendeeCard?.length) {
      return NextResponse.json({ success: false, message: 'This card is an attendee’s card at an event. Use a different card.' }, { status: 409 });
    }
    const { data: existing } = await supabaseAdmin
      .from('registration_verifiers').select('firstname, lastname').in('uid', uidCandidates(body.uid)).limit(1);
    if (existing?.length) {
      return NextResponse.json({ success: false, message: `This card is already ${existing[0].firstname} ${existing[0].lastname}'s.` }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from('registration_verifiers')
      .insert({ uid: normalizeUid(body.uid), firstname, lastname, created_by: body.actorId })
      .select(COLUMNS)
      .single();
    if (error) return fail(error);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const no = await denied(body.actorId);
    if (no) return no;
    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const patch = { updated_at: new Date().toISOString() };
    if (body.firstname !== undefined) patch.firstname = titleCase(body.firstname);
    if (body.lastname !== undefined) patch.lastname = titleCase(body.lastname);
    if (body.isActive !== undefined) patch.is_active = !!body.isActive;
    if (patch.firstname === '' || patch.lastname === '') {
      return NextResponse.json({ success: false, message: 'First name and last name are required.' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('registration_verifiers').update(patch).eq('id', body.id).select(COLUMNS).single();
    if (error) return fail(error);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const no = await denied(searchParams.get('actorId'));
    if (no) return no;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const { error } = await supabaseAdmin.from('registration_verifiers').delete().eq('id', id);
    if (error) return fail(error);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
