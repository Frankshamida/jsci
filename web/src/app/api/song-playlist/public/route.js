import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  SONG_BUDGET_PAUSE_PERCENT, cloudinaryCreditsUsedPercent, publicSong, withSongUrls,
} from '@/lib/songPlaylist';

// GET /api/song-playlist/public
//
// The whole Song Playlist for attendees - the music they can put on an event
// story. No login (the event page has none). Only what a listener needs, and
// nothing at all past the Cloudinary budget line (see songPlaylist.js).

export const dynamic = 'force-dynamic';

const COLUMNS = 'id, title, artist, artist_id, cover_url, audio_url, duration_seconds, created_at, song_artists(name, cover_url)';

export async function GET() {
  try {
    const used = await cloudinaryCreditsUsedPercent();
    if (used !== null && used >= SONG_BUDGET_PAUSE_PERCENT) {
      return NextResponse.json({ success: true, paused: true, data: [] });
    }

    const { data, error } = await supabaseAdmin
      .from('song_playlist')
      .select(COLUMNS)
      .order('created_at', { ascending: true });
    // Playlist not set up yet: no music, not an error.
    if (error) return NextResponse.json({ success: true, paused: false, data: [] });

    const songs = (data || [])
      .map((row) => publicSong(withSongUrls(row)))
      .sort((a, b) => a.artist.localeCompare(b.artist) || 0);
    return NextResponse.json(
      { success: true, paused: false, data: songs },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
