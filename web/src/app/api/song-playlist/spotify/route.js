import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';
import { SpotifyError, forgetTrustedArtists, getTrack, isSpotifyId } from '@/lib/spotify';

// Song Playlist > Spotify: the Song List of saved Spotify songs. See
// supabase/migrations/spotify_songs.sql. Only a reference is stored; the songs
// play through Spotify's embedded player. Everybody may list; only an Admin or
// Super Admin may add or remove.

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/spotify_songs.sql in the Supabase SQL editor first.';
const missingTable = (err) => /spotify_songs/i.test(err?.message || '');
// '*' so a database that has not re-run the migration (no album_id yet) still lists.
const COLUMNS = '*';
const missingAlbumColumn = (err) => /album_id/i.test(err?.message || '');

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  if (!isEventManager(actor)) {
    return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can do this.' }, { status: 403 });
  }
  return null;
}

// GET /api/song-playlist/spotify   the Song List, newest first
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('spotify_songs').select(COLUMNS).order('created_at', { ascending: false });
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/song-playlist/spotify   { actorId, spotifyId }
export async function POST(request) {
  try {
    const body = await request.json();
    const denied = await requireManager(body.actorId);
    if (denied) return denied;
    if (!isSpotifyId(body.spotifyId)) return NextResponse.json({ success: false, message: 'Pick a song from Spotify.' }, { status: 400 });

    const track = await getTrack(body.spotifyId);
    if (track.explicit) return NextResponse.json({ success: false, message: 'Explicit songs cannot be added.' }, { status: 400 });

    const row = {
      spotify_id: track.id,
      title: track.title.slice(0, 200),
      artists: track.artists.slice(0, 300),
      artist_ids: track.artistIds,
      album: track.album?.slice(0, 200) || null,
      image_url: track.image,
      external_url: track.url,
      duration_ms: track.durationMs,
      explicit: track.explicit,
      added_by: body.actorId,
      album_id: track.albumId,
    };
    const save = (r) => supabaseAdmin.from('spotify_songs').upsert(r, { onConflict: 'spotify_id' }).select(COLUMNS).single();
    let { data, error } = await save(row);
    if (error && missingAlbumColumn(error)) {
      const { album_id: _unused, ...withoutAlbum } = row; // eslint-disable-line no-unused-vars
      ({ data, error } = await save(withoutAlbum));
    }
    if (error) {
      if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
      throw error;
    }
    forgetTrustedArtists();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof SpotifyError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE /api/song-playlist/spotify?id=..&actorId=..
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const denied = await requireManager(searchParams.get('actorId'));
    if (denied) return denied;

    const { error } = await supabaseAdmin.from('spotify_songs').delete().eq('id', id);
    if (error) throw error;
    forgetTrustedArtists();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
