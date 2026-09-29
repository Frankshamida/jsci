import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventForPublicSlug, readPass, REG_FIELDS } from '@/lib/eventAccess';
import { formatPersonName } from '@/lib/eventFormat';

// GET /api/events/public/profile?slug=...   (header x-event-pass: <pass>)
//   The names on the holder's virtual ID. The same pass as the photos: the
//   ID belongs to whoever unlocked with their password or card.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const event = await eventForPublicSlug(searchParams.get('slug'));
    if (!event) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }
    const pass = readPass(request.headers.get('x-event-pass'), event.id);
    if (!pass) {
      return NextResponse.json({ success: false, locked: true, message: 'Unlock your profile first.' }, { status: 401 });
    }

    const { data: reg, error } = await supabaseAdmin
      .from('event_registrations')
      .select(REG_FIELDS)
      .eq('id', pass.registrationId)
      .eq('event_id', event.id)
      .maybeSingle();
    if (error) throw error;
    if (!reg || reg.deleted_at || reg.status === 'cancelled') {
      return NextResponse.json({ success: false, locked: true, message: 'This registration is no longer active.' }, { status: 401 });
    }

    // Older rows were saved before first and last name were split out (the
    // same recovery as the desk's ID maker).
    const whole = String(reg.attendee_name || '').trim().replace(/\s+/g, ' ');
    const first = reg.attendee_firstname || whole.split(' ').slice(0, -1).join(' ') || whole;
    const last = reg.attendee_lastname || (whole.includes(' ') ? whole.split(' ').slice(-1)[0] : '');

    return NextResponse.json({
      success: true,
      firstName: formatPersonName(first),
      lastName: formatPersonName(last),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
