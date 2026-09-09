import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeUid, isPlausibleUid, uidCandidates } from '@/lib/rfid';

// A tap. One card number in, one answer out: whose card it is, or nobody's.
//
// Every tap is logged either way. The misses matter more than the hits - an
// unregistered card being tapped over and over is a person standing at the
// door, and without the log there is no way to know that happened.

const USER_FIELDS = 'id, firstname, lastname, email, ministry, role, status, profile_picture';

// GET /api/rfid/scan?limit=25 - the recent taps, for the desk to look back at.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '25', 10) || 25, 1), 200);

    const { data, error } = await supabaseAdmin
      .from('rfid_scans')
      .select(`*, users:user_id (${USER_FIELDS})`)
      .order('scanned_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/rfid/scan  { uid, source, scannedBy, markAttendance, eventDate }
export async function POST(request) {
  try {
    const body = await request.json();
    const raw = body.uid;
    // 'nfc' is a phone reading the card with its own NFC aerial - no reader
    // hardware at all. Worth recording as itself: "which desk did this tap
    // come from" is answered by it.
    const source = ['serial', 'keyboard', 'nfc', 'manual'].includes(body.source) ? body.source : 'manual';
    const scannedBy = body.scannedBy || null;

    if (!isPlausibleUid(raw)) {
      return NextResponse.json({ success: false, message: 'That does not look like a card number' }, { status: 400 });
    }

    const uid = normalizeUid(raw);

    // Any spelling of the number finds the card it was registered under.
    const { data: card, error: cardError } = await supabaseAdmin
      .from('rfid_cards')
      .select(`*, users:user_id (${USER_FIELDS})`)
      .in('uid', uidCandidates(raw))
      .maybeSingle();
    if (cardError) throw cardError;

    const result = !card ? 'unknown' : (card.is_active ? 'matched' : 'inactive');

    // Log first, act second. If marking attendance fails the tap is still on
    // record, which is the half that cannot be reconstructed afterwards.
    const { data: scan } = await supabaseAdmin
      .from('rfid_scans')
      .insert([{
        uid,
        raw_uid: String(raw).slice(0, 128),
        user_id: card?.user_id || null,
        result,
        source,
        scanned_by: scannedBy,
      }])
      .select(`*, users:user_id (${USER_FIELDS})`)
      .single();

    if (!card) {
      return NextResponse.json({
        success: true,
        result: 'unknown',
        uid,
        scan,
        message: 'This card is not registered to anyone yet',
      });
    }

    if (!card.is_active) {
      return NextResponse.json({
        success: true,
        result: 'inactive',
        uid,
        card,
        user: card.users,
        scan,
        message: 'This card was marked lost. Reactivate it before using it.',
      });
    }

    // Counters on the card, so "when was this last used" is answerable without
    // reading the whole scan log.
    await supabaseAdmin
      .from('rfid_cards')
      .update({ last_seen_at: new Date().toISOString(), scan_count: (card.scan_count || 0) + 1 })
      .eq('id', card.id);

    let attendance = null;
    let attendanceMessage = '';
    if (body.markAttendance) {
      const eventDate = body.eventDate || new Date().toISOString().slice(0, 10);
      // Tapping twice must not create two rows, and must not silently reopen a
      // record somebody has since corrected by hand - so an existing record
      // for the day is reported back, not overwritten.
      const { data: existing } = await supabaseAdmin
        .from('attendance')
        .select('*')
        .eq('user_id', card.user_id)
        .eq('event_date', eventDate)
        .maybeSingle();

      if (existing) {
        attendance = existing;
        attendanceMessage = `Already marked ${existing.status} today`;
      } else {
        const { data: inserted, error: attError } = await supabaseAdmin
          .from('attendance')
          .insert([{
            user_id: card.user_id,
            event_date: eventDate,
            status: 'Present',
            marked_by: scannedBy,
            notes: 'Checked in by RFID card',
          }])
          .select()
          .single();
        if (attError) {
          attendanceMessage = `Card read, but attendance failed: ${attError.message}`;
        } else {
          attendance = inserted;
          attendanceMessage = 'Marked present';
        }
      }
    }

    const name = `${card.users?.firstname || ''} ${card.users?.lastname || ''}`.trim() || 'Member';
    return NextResponse.json({
      success: true,
      result: 'matched',
      uid,
      card,
      user: card.users,
      scan,
      attendance,
      message: attendanceMessage ? `${name} - ${attendanceMessage}` : `Welcome, ${name}`,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
