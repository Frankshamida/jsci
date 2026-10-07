import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPlausibleUid, normalizeUid, uidCandidates } from '@/lib/rfid';
import { findEventActor } from '@/lib/eventCommittee';

// The Super Admin's own access card, under Events RFID.
//
// It is an ordinary member card (rfid_cards) held by the Super Admin and
// labelled "Super Admin Access", so everywhere that already takes a staff
// card takes it too - tapped at Registration Verification, it signs the desk
// in as the Super Admin instead of the test password (api/events/verification).
//
//   GET    ?actorId=..               the signed-in Super Admin's access cards
//   POST   { actorId, uid }          set a card as their access card
//   DELETE ?id=..&actorId=..         take one of their access cards off
//
// Super Admin only, and only ever their OWN account - nobody sets a card that
// signs in as somebody else.

export const dynamic = 'force-dynamic';

const LABEL = 'Super Admin Access';
const COLUMNS = 'id, uid, label, is_active, assigned_at, last_seen_at, scan_count';
const nameOf = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(' ').trim() || 'a member';

async function superAdmin(actorId) {
  const actor = await findEventActor(actorId);
  return actor && actor.role === 'Super Admin' && actor.is_active !== false ? actor : null;
}
const denied = () => NextResponse.json({ success: false, message: 'Only a Super Admin can set a Super Admin access card.' }, { status: 403 });
const fail = (error) => NextResponse.json({ success: false, message: error?.message || 'Something went wrong' }, { status: 500 });

export async function GET(request) {
  try {
    const actor = await superAdmin(new URL(request.url).searchParams.get('actorId'));
    if (!actor) return denied();
    const { data, error } = await supabaseAdmin
      .from('rfid_cards').select(COLUMNS).eq('user_id', actor.id).eq('label', LABEL)
      .order('assigned_at', { ascending: false });
    if (error) return fail(error);
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await superAdmin(body.actorId);
    if (!actor) return denied();
    if (!isPlausibleUid(body.uid)) return NextResponse.json({ success: false, message: 'Tap a card first.' }, { status: 400 });
    const ids = uidCandidates(body.uid);

    // A card that is already somebody's, or already does another job, is not
    // an access card - said by name, so the desk knows which card it was.
    const { data: attendeeCard } = await supabaseAdmin
      .from('rfid_event_cards').select('id').in('uid', ids).limit(1);
    if (attendeeCard?.length) {
      return NextResponse.json({ success: false, message: 'This card is an attendee’s card at an event. Use a different card.' }, { status: 409 });
    }
    const { data: verifier } = await supabaseAdmin
      .from('registration_verifiers').select('firstname, lastname').in('uid', ids).limit(1);
    if (verifier?.length) {
      return NextResponse.json({ success: false, message: `This card is ${verifier[0].firstname} ${verifier[0].lastname}'s verifier card. Use a different card.` }, { status: 409 });
    }
    // Before rfid_card_stock.sql there is no stock to be in.
    const { data: stock } = await supabaseAdmin
      .from('rfid_card_stock').select('number').in('uid', ids).limit(1)
      .then((r) => r, () => ({ data: [] }));
    if (stock?.length) {
      return NextResponse.json({ success: false, message: `This card is #${stock[0].number} in the RFID Card Stock. Take it out of the stock first, or use a different card.` }, { status: 409 });
    }

    const { data: held } = await supabaseAdmin
      .from('rfid_cards').select('id, user_id, users:user_id (firstname, lastname)').in('uid', ids).limit(1);
    const existing = held?.[0] || null;
    if (existing && existing.user_id !== actor.id) {
      return NextResponse.json({ success: false, message: `This card is already registered to ${nameOf(existing.users)}. Remove it from them first.` }, { status: 409 });
    }

    // Already theirs (a member card, or this one marked lost): it becomes the
    // access card, switched on.
    const { data, error } = existing
      ? await supabaseAdmin.from('rfid_cards')
        .update({ is_active: true, label: LABEL }).eq('id', existing.id).select(COLUMNS).single()
      : await supabaseAdmin.from('rfid_cards')
        .insert([{
          uid: normalizeUid(body.uid),
          raw_uid: String(body.uid).slice(0, 128),
          user_id: actor.id,
          label: LABEL,
          assigned_by: actor.id,
        }])
        .select(COLUMNS).single();
    if (error) return fail(error);

    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: actor.id, user_name: nameOf(actor),
        action: 'rfid_super_access_set', resource: 'rfid_card', resource_id: String(data.id),
        details: `Set card ${data.uid} as their Super Admin access card`,
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, data, message: 'Super Admin access card set' });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await superAdmin(searchParams.get('actorId'));
    if (!actor) return denied();
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    // Only their own - the user_id in the filter is what makes it so.
    const { data, error } = await supabaseAdmin
      .from('rfid_cards').delete().eq('id', id).eq('user_id', actor.id).eq('label', LABEL).select('id');
    if (error) return fail(error);
    if (!data?.length) return NextResponse.json({ success: false, message: 'That access card is not yours, or is already gone.' }, { status: 404 });

    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: actor.id, user_name: nameOf(actor),
        action: 'rfid_super_access_removed', resource: 'rfid_card', resource_id: String(id),
        details: 'Removed their Super Admin access card',
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, message: 'Access card removed' });
  } catch (error) {
    return fail(error);
  }
}
