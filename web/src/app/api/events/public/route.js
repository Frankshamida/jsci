import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventForPublicSlug, registrationForCode, displayName, homeEventForCode } from '@/lib/eventAccess';
import { passwordYear } from '@/lib/eventPublic';
import { SONG_BUDGET_PAUSE_PERCENT, cloudinaryCreditsUsedPercent, songsForIds } from '@/lib/songPlaylist';

const PROGRAMME_FIELDS = 'id, day_date, start_time, end_time, title, speaker, kind, venue, notes';

async function programmeFor(eventId) {
  const list = (fields) => supabaseAdmin
    .from('event_programme')
    .select(fields)
    .eq('event_id', eventId)
    .order('day_date', { ascending: true })
    .order('start_time', { ascending: true });
  const withSongs = await list(`${PROGRAMME_FIELDS}, song_ids`);
  // Before event_programme_songs.sql: the programme without songs.
  if (withSongs.error && /song_ids/i.test(withSongs.error.message || '')) return list(PROGRAMME_FIELDS);
  return withSongs;
}

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
      programmeFor(event.id),
    ]);

    // The songs on Worship items, once each - the items carry only ids.
    // Past the budget line they are not offered at all (see songPlaylist.js),
    // so a full room cannot run the Cloudinary account dry.
    const rows = programme.error ? [] : (programme.data || []);
    const songIds = rows.flatMap((r) => r.song_ids || []);
    let songs = [];
    let songsPaused = false;
    if (songIds.length) {
      const used = await cloudinaryCreditsUsedPercent();
      songsPaused = used !== null && used >= SONG_BUDGET_PAUSE_PERCENT;
      if (!songsPaused) songs = await songsForIds(supabaseAdmin, songIds);
    }

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
      programme: rows,
      songs,
      songsPaused,
      passwordYear: passwordYear(event),
    }, { headers: { 'Cache-Control': cacheControl } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
