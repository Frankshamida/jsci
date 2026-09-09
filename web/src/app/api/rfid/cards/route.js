import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeUid, isPlausibleUid, uidCandidates } from '@/lib/rfid';

// Registered cards: who holds what.
//
// Every write here goes through normalizeUid() so the table only ever holds
// one spelling of a card number. See src/lib/rfid.js for why that matters.

const USER_FIELDS = 'id, firstname, lastname, email, ministry, role, status, profile_picture';

// GET /api/rfid/cards            every card, newest first
// GET /api/rfid/cards?userId=..  just one member's cards
// GET /api/rfid/cards?uid=..     look one card up (used to warn before assigning)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const uid = searchParams.get('uid');

    let query = supabaseAdmin
      .from('rfid_cards')
      .select(`*, users:user_id (${USER_FIELDS})`)
      .order('assigned_at', { ascending: false });

    if (userId) query = query.eq('user_id', userId);
    if (uid) {
      // Any spelling of the card finds the row it was registered under.
      const candidates = uidCandidates(uid);
      if (candidates.length === 0) return NextResponse.json({ success: true, data: [] });
      query = query.in('uid', candidates);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/rfid/cards - give a card to a member.
export async function POST(request) {
  try {
    const body = await request.json();
    const { userId, label, assignedBy } = body;
    const raw = body.uid;

    if (!userId) {
      return NextResponse.json({ success: false, message: 'Choose a member for this card' }, { status: 400 });
    }
    if (!isPlausibleUid(raw)) {
      return NextResponse.json({ success: false, message: 'That does not look like a card number' }, { status: 400 });
    }

    const uid = normalizeUid(raw);

    // A card already on file belongs to somebody. Say who, rather than failing
    // on a unique-constraint error the desk cannot act on - "Maria has this
    // card" is something a person can resolve; "duplicate key" is not.
    const { data: existing } = await supabaseAdmin
      .from('rfid_cards')
      .select(`*, users:user_id (${USER_FIELDS})`)
      .in('uid', uidCandidates(raw))
      .maybeSingle();

    if (existing) {
      if (existing.user_id === userId) {
        // Same card, same person: treat as a re-registration rather than an
        // error. Reactivates a card that had been marked lost.
        const { data, error } = await supabaseAdmin
          .from('rfid_cards')
          .update({ is_active: true, label: label ?? existing.label })
          .eq('id', existing.id)
          .select(`*, users:user_id (${USER_FIELDS})`)
          .single();
        if (error) throw error;
        return NextResponse.json({ success: true, data, message: 'Card is active again' });
      }
      const holder = existing.users
        ? `${existing.users.firstname || ''} ${existing.users.lastname || ''}`.trim() || 'another member'
        : 'another member';
      return NextResponse.json({
        success: false,
        code: 'ALREADY_ASSIGNED',
        message: `That card is already registered to ${holder}. Remove it from them first.`,
        data: existing,
      }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from('rfid_cards')
      .insert([{
        uid,
        raw_uid: String(raw).slice(0, 128),
        user_id: userId,
        label: label || null,
        assigned_by: assignedBy || null,
      }])
      .select(`*, users:user_id (${USER_FIELDS})`)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Card registered' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PATCH /api/rfid/cards - rename a card, or mark one lost/found.
export async function PATCH(request) {
  try {
    const { id, label, isActive } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'Card id required' }, { status: 400 });

    const patch = {};
    if (label !== undefined) patch.label = label || null;
    if (isActive !== undefined) patch.is_active = !!isActive;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, message: 'Nothing to change' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('rfid_cards')
      .update(patch)
      .eq('id', id)
      .select(`*, users:user_id (${USER_FIELDS})`)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Card updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE /api/rfid/cards?id=..  take a card off a member for good.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'Card id required' }, { status: 400 });

    const { error } = await supabaseAdmin.from('rfid_cards').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Card removed' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
