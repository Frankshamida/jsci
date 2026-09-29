import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventForPublicSlug, registrationForCode, displayName, homeEventForCode } from '@/lib/eventAccess';
import { passwordYear } from '@/lib/eventPublic';

// GET /api/events/public?slug=cebu-miracle-working-god&t=<code>
//
// Everything the public event page shows before anything is unlocked: the
// event, the programme, and - when the page was opened from an ID's QR - the
// name of the attendee to welcome. No login: this is the page a phone camera
// lands on at the door.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const event = await eventForPublicSlug(searchParams.get('slug'));
    if (!event) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }

    const [reg, programme] = await Promise.all([
      registrationForCode(event.id, searchParams.get('t')),
      supabaseAdmin
        .from('event_programme')
        .select('id, day_date, start_time, end_time, title, speaker, kind, venue, notes')
        .eq('event_id', event.id)
        .order('day_date', { ascending: true })
        .order('start_time', { ascending: true }),
    ]);

    // An ID opens only the event its holder is registered in. A QR code from
    // another event's attendee is sent to their own event's page.
    const code = searchParams.get('t');
    if (code && !reg) {
      const home = await homeEventForCode(code);
      if (home && home.event.id !== event.id) {
        return NextResponse.json({ success: false, redirect: home.slug, message: 'This ID is for a different event.' });
      }
    }

    // With ?t= the answer names a person, so it must never sit in a shared cache.
    const cacheControl = code
      ? 'private, no-store'
      : 'public, max-age=0, s-maxage=30, stale-while-revalidate=300';

    return NextResponse.json({
      success: true,
      event,
      guest: reg ? { name: displayName(reg) } : null,
      // Missing table = migration not run yet: an empty programme, not an error page.
      programme: programme.error ? [] : (programme.data || []),
      passwordYear: passwordYear(event),
    }, { headers: { 'Cache-Control': cacheControl } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
