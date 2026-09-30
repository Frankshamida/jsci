import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/cloudinary';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';
import { isSongPlaylistAsset, isCloudinaryHttps, withSongUrls } from '@/lib/songPlaylist';

// Songs in Worship & Schedule > Song Playlist. See
// supabase/migrations/song_playlist.sql and song_artists.sql.
//
// A song is a title and an audio file under an artist; its cover is the
// artist's (./artists). The audio never passes through here: the browser
// uploads it straight to Cloudinary with a signature from ./sign, then posts
// the result to save the row. Everybody may list; only an Admin or Super Admin
// may add or delete.

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/song_playlist.sql, then song_artists.sql.';
const missingTable = (err) => /song_playlist|song_artists|artist_id/i.test(err?.message || '');
const COLUMNS = 'id, title, artist, artist_id, cover_url, cover_public_id, audio_url, audio_public_id, duration_seconds, created_at, song_artists(id, name, cover_url, cover_public_id)';

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  if (!isEventManager(actor)) {
    return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can do this.' }, { status: 403 });
  }
  return null;
}

// GET /api/song-playlist   every song, in the order they were added
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('song_playlist')
      .select(COLUMNS)
      .order('created_at', { ascending: true });
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }
    return NextResponse.json({ success: true, data: (data || []).map(withSongUrls) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/song-playlist
//   { actorId, artistId, title, audio: { publicId, url, duration } }
export async function POST(request) {
  try {
    const body = await request.json();
    const denied = await requireManager(body.actorId);
    if (denied) return denied;

    const title = String(body.title || '').trim().slice(0, 150);
    const { artistId, audio } = body;
    if (!title) return NextResponse.json({ success: false, message: 'Song title is required.' }, { status: 400 });
    if (!artistId) return NextResponse.json({ success: false, message: 'Choose the artist.' }, { status: 400 });
    if (!isSongPlaylistAsset(audio?.publicId) || !isCloudinaryHttps(audio?.url)) {
      return NextResponse.json({ success: false, message: 'Upload the audio first.' }, { status: 400 });
    }

    const { data: artist, error: artistError } = await supabaseAdmin
      .from('song_artists').select('id, name').eq('id', artistId).maybeSingle();
    if (artistError) {
      if (missingTable(artistError)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw artistError;
    }
    if (!artist) return NextResponse.json({ success: false, message: 'That artist no longer exists.' }, { status: 404 });

    const duration = Number(audio.duration);
    const { data, error } = await supabaseAdmin
      .from('song_playlist')
      .insert({
        title,
        artist_id: artist.id,
        artist: artist.name,
        audio_url: audio.url,
        audio_public_id: audio.publicId,
        duration_seconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 10) / 10 : null,
        created_by: body.actorId,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }
    return NextResponse.json({ success: true, data: withSongUrls(data) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE /api/song-playlist?id=..&actorId=..
//   Drops the row, then its audio. The row goes first so a failed clean-up
//   can never leave a song pointing at a file that is gone. The artist's cover
//   stays - other songs use it.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const denied = await requireManager(searchParams.get('actorId'));
    if (denied) return denied;

    const { data: row, error } = await supabaseAdmin
      .from('song_playlist')
      .delete()
      .eq('id', id)
      .select('cover_public_id, audio_public_id, song_artists(cover_public_id)')
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ success: false, message: 'Song not found.' }, { status: 404 });

    // A song from before artists may still carry a cover of its own.
    const ownCover = row.cover_public_id && row.cover_public_id !== row.song_artists?.cover_public_id
      ? row.cover_public_id : null;

    // Best effort: a stray asset costs storage, not correctness.
    await Promise.allSettled([
      isSongPlaylistAsset(ownCover) ? deleteFromCloudinary(ownCover, 'image') : null,
      isSongPlaylistAsset(row.audio_public_id) ? deleteFromCloudinary(row.audio_public_id, 'video') : null,
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
