import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPlausibleUid, normalizeUid, uidCandidates } from '@/lib/rfid';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// The card stock under Events RFID - see supabase/migrations/rfid_card_stock.sql.
// Admin / Super Admin only.
//
//   GET    ?actorId=..[&eventId=..]       every stored card, by number, with who holds it
//   POST   { actorId, uid }               store a tapped card as the next number
//   DELETE ?id=..&actorId=..               take an unused card out of the stock

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/rfid_card_stock.sql first.';
const fail = (error) => NextResponse.json(
  { success: false, message: /rfid_card_stock/i.test(error?.message || '') ? MIGRATION_HINT : (error?.message || 'Something went wrong') },
  { status: 500 },
);

async function denied(actorId) {
  const actor = await findEventActor(actorId);
  if (isEventManager(actor)) return { actor };
  return { no: NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can manage the card stock.' }, { status: 403 }) };
}

// Who already holds this card, anywhere: an attendee at any event, a
// member, or a verifier. A card that is somebody's is never stock.
async function holderOf(raw) {
  const ids = uidCandidates(raw);
  const { data: ev } = await supabaseAdmin.from('rfid_event_cards')
    .select('registration_id, event_registrations:registration_id (attendee_name)').in('uid', ids).limit(1);
  if (ev?.[0]) return `${ev[0].event_registrations?.attendee_name || 'an attendee'}'s (event card)`;
  const { data: mem } = await supabaseAdmin.from('rfid_cards')
    .select('users:user_id (firstname, lastname)').in('uid', ids).limit(1);
  if (mem?.[0]) return `${[mem[0].users?.firstname, mem[0].users?.lastname].filter(Boolean).join(' ') || 'a member'}'s (member card)`;
  const { data: ver } = await supabaseAdmin.from('registration_verifiers').select('firstname, lastname').in('uid', ids).limit(1);
  if (ver?.[0]) return `${ver[0].firstname} ${ver[0].lastname}'s (verifier card)`;
  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { no } = await denied(searchParams.get('actorId'));
    if (no) return no;
    const { data, error } = await supabaseAdmin.from('rfid_card_stock')
      .select('id, number, uid, created_at').order('number', { ascending: true }).limit(5000);
    if (error) return fail(error);
    const rows = data || [];
    // Used: linked to an attendee at any event.
    let used = {};
    if (rows.length) {
      const { data: links } = await supabaseAdmin.from('rfid_event_cards')
        .select('uid, event_id, registration_id, event_registrations:registration_id (attendee_name), events:event_id (title)')
        .in('uid', rows.map((r) => r.uid));
      used = Object.fromEntries((links || []).map((l) => [l.uid, {
        name: l.event_registrations?.attendee_name || '',
        event: l.events?.title || '',
        eventId: l.event_id,
        registrationId: l.registration_id,
      }]));
    }
    return NextResponse.json({ success: true, data: rows.map((r) => ({ ...r, used: used[r.uid] || null })) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { no, actor } = await denied(body.actorId);
    if (no) return no;
    if (!isPlausibleUid(body.uid)) return NextResponse.json({ success: false, message: 'That does not look like a card number.' }, { status: 400 });
    const uid = normalizeUid(body.uid);

    const { data: inStock, error: inErr } = await supabaseAdmin.from('rfid_card_stock')
      .select('id, number').in('uid', uidCandidates(body.uid)).maybeSingle();
    if (inErr) return fail(inErr);
    if (inStock) return NextResponse.json({ success: false, already: true, message: `That card is already in the stock as #${inStock.number}.`, number: inStock.number }, { status: 409 });
    const holder = await holderOf(body.uid);
    if (holder) return NextResponse.json({ success: false, message: `That card is already ${holder}.` }, { status: 409 });

    // The next number. Two taps at once can race for it; the unique index
    // catches that, and the second one simply takes the number after.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: last } = await supabaseAdmin.from('rfid_card_stock')
        .select('number').order('number', { ascending: false }).limit(1).maybeSingle();
      const number = (Number(last?.number) || 0) + 1;
      const { data, error } = await supabaseAdmin.from('rfid_card_stock')
        .insert([{ number, uid, added_by: actor.id }]).select('id, number, uid, created_at').single();
      if (!error) return NextResponse.json({ success: true, data: { ...data, used: null } });
      if (error.code !== '23505' || /uid/i.test(error.message || '')) return fail(error);
    }
    return NextResponse.json({ success: false, message: 'Could not number that card - tap it again.' }, { status: 409 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { no } = await denied(searchParams.get('actorId'));
    if (no) return no;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const { data: row } = await supabaseAdmin.from('rfid_card_stock').select('id, uid, number').eq('id', id).maybeSingle();
    if (!row) return NextResponse.json({ success: false, message: 'That card is not in the stock.' }, { status: 404 });
    // Still somebody's - an attendee at any event, a member, or a verifier -
    // and it stays in the stock, so its number is never lost.
    const holder = await holderOf(row.uid);
    if (holder) return NextResponse.json({ success: false, message: `Card #${row.number} cannot be removed - it is ${holder}.` }, { status: 409 });
    const { error } = await supabaseAdmin.from('rfid_card_stock').delete().eq('id', id);
    if (error) return fail(error);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
