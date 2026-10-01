import { NextResponse } from 'next/server';
import { cached, rateLimit } from '@/lib/serverCache';
import { findEventActor } from '@/lib/eventCommittee';
import { SpotifyError, christianSuggestions, getAlbum, getTrack, searchChristianTracks, spotifyConfigured } from '@/lib/spotify';

// Christian songs from Spotify, for the Song Playlist and the lineup song
// picker. See src/lib/spotify.js for how calls are kept under Spotify's limit.
//
//   GET /api/spotify?mode=search&q=way+maker&offset=0&actorId=..
//   GET /api/spotify?mode=suggestions&actorId=..
//   GET /api/spotify?mode=album&id=<album id> (or &track=<track id>)&actorId=..
//
// Signed-in members only, and each one is rate-limited, so nobody can spend
// the app's Spotify allowance from outside it.

export const dynamic = 'force-dynamic';

const PER_USER_PER_MINUTE = 40;

// Who is asking, remembered for five minutes so a search is not also a
// database read every keystroke.
async function knownActor(actorId) {
  if (!actorId) return false;
  return cached(`spotify:actor:${actorId}`, 5 * 60 * 1000, async () => {
    const actor = await findEventActor(actorId);
    return !!actor && actor.is_active !== false;
  });
}

const fail = (message, status, retryAfterSec) => NextResponse.json(
  { success: false, message, retryAfter: retryAfterSec || undefined },
  { status, headers: retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : undefined },
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actorId = searchParams.get('actorId');
    const mode = searchParams.get('mode') || 'search';

    if (!spotifyConfigured()) return fail('Spotify is not set up on the server yet.', 503);
    if (!(await knownActor(actorId))) return fail('Sign in to search Spotify.', 401);

    const limit = rateLimit(`spotify:user:${actorId}`, PER_USER_PER_MINUTE, 60 * 1000);
    if (!limit.allowed) return fail('Slow down a little - too many Spotify searches.', 429, Math.ceil(limit.retryAfterMs / 1000));

    if (mode === 'suggestions') {
      return NextResponse.json({ success: true, data: await christianSuggestions() });
    }
    if (mode === 'album') {
      // A song saved before albums were kept is looked up by its track.
      const albumId = searchParams.get('id') || (await getTrack(searchParams.get('track'))).albumId;
      return NextResponse.json({ success: true, data: await getAlbum(albumId) });
    }
    const data = await searchChristianTracks(searchParams.get('q'), searchParams.get('offset'));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof SpotifyError) return fail(error.message, error.status, error.retryAfterSec);
    return fail(error.message || 'Could not reach Spotify.', 500);
  }
}
