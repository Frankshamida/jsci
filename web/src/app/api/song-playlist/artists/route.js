import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/cloudinary';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';
import { isSongPlaylistAsset, isCloudinaryHttps, withArtistUrls } from '@/lib/songPlaylist';

// Artists in the Song Playlist. See supabase/migrations/song_artists.sql.
//
// An artist is a name and a 1080x1080 WebP cover; every song under it uses
// that cover. The cover is uploaded straight to Cloudinary with a signature
// from ../sign (kind 'cover'). Everybody may list; only an Admin or Super
// Admin may add, change or delete.

export const dynamic = 'force-dynamic';

const MIGRATION_HINT = 'Run supabase/migrations/song_artists.sql first.';
const missingTable = (err) => /song_artists/i.test(err?.message || '');
const duplicateName = (err) => err?.code === '23505';
const COLUMNS = 'id, name, cover_url, cover_public_id, created_at';

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  if (!isEventManager(actor)) {
    return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can do this.' }, { status: 403 });
  }
  return null;
}

function fail(error) {
  if (missingTable(error)) return NextResponse.json({ success: false, message: MIGRATION_HINT }, { status: 500 });
  if (duplicateName(error)) return NextResponse.json({ success: false, message: 'There is already an artist with that name.' }, { status: 409 });
  return NextResponse.json({ success: false, message: error.message }, { status: 500 });
}

const cleanName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 150);
const validCover = (cover) => isSongPlaylistAsset(cover?.publicId) && isCloudinaryHttps(cover?.url);

// GET /api/song-playlist/artists   A to Z
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('song_artists')
      .select(COLUMNS)
      .order('name', { ascending: true });
    if (error) return fail(error);
    return NextResponse.json({ success: true, data: (data || []).map(withArtistUrls) });
  } catch (error) {
    return fail(error);
  }
}

// POST /api/song-playlist/artists   { actorId, name, cover: { publicId, url } }
export async function POST(request) {
  try {
    const body = await request.json();
    const denied = await requireManager(body.actorId);
    if (denied) return denied;

    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ success: false, message: 'Artist name is required.' }, { status: 400 });
    if (!validCover(body.cover)) return NextResponse.json({ success: false, message: 'Upload the artist cover first.' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('song_artists')
      .insert({ name, cover_url: body.cover.url, cover_public_id: body.cover.publicId, created_by: body.actorId })
      .select(COLUMNS)
      .single();
    if (error) {
      // The cover was uploaded for an artist that was not saved.
      deleteFromCloudinary(body.cover.publicId, 'image').catch(() => {});
      return fail(error);
    }
    return NextResponse.json({ success: true, data: withArtistUrls(data) });
  } catch (error) {
    return fail(error);
  }
}

// PATCH /api/song-playlist/artists   { actorId, id, name?, cover? }
//   Rename and/or replace the cover. The old cover is deleted once the new
//   one is saved.
export async function PATCH(request) {
  try {
    const body = await request.json();
    const denied = await requireManager(body.actorId);
    if (denied) return denied;
    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { data: before, error: readError } = await supabaseAdmin
      .from('song_artists').select(COLUMNS).eq('id', body.id).maybeSingle();
    if (readError) return fail(readError);
    if (!before) return NextResponse.json({ success: false, message: 'Artist not found.' }, { status: 404 });

    const patch = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) return NextResponse.json({ success: false, message: 'Artist name is required.' }, { status: 400 });
      patch.name = name;
    }
    if (body.cover) {
      if (!validCover(body.cover)) return NextResponse.json({ success: false, message: 'Upload the artist cover first.' }, { status: 400 });
      patch.cover_url = body.cover.url;
      patch.cover_public_id = body.cover.publicId;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ success: true, data: withArtistUrls(before) });

    const { data, error } = await supabaseAdmin
      .from('song_artists').update(patch).eq('id', body.id).select(COLUMNS).single();
    if (error) return fail(error);

    // Keep the denormalised name on the songs in step (older code reads it).
    if (patch.name) await supabaseAdmin.from('song_playlist').update({ artist: patch.name }).eq('artist_id', body.id);
    if (patch.cover_public_id && isSongPlaylistAsset(before.cover_public_id) && before.cover_public_id !== patch.cover_public_id) {
      deleteFromCloudinary(before.cover_public_id, 'image').catch(() => {});
    }
    return NextResponse.json({ success: true, data: withArtistUrls(data) });
  } catch (error) {
    return fail(error);
  }
}

// DELETE /api/song-playlist/artists?id=..&actorId=..
//   The artist and every song under it (the foreign key cascades), then the
//   cover and each song's audio on Cloudinary.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    const denied = await requireManager(searchParams.get('actorId'));
    if (denied) return denied;

    const { data: songs, error: songsError } = await supabaseAdmin
      .from('song_playlist').select('audio_public_id, cover_public_id').eq('artist_id', id);
    if (songsError) return fail(songsError);

    const { data: row, error } = await supabaseAdmin
      .from('song_artists').delete().eq('id', id).select('cover_public_id').maybeSingle();
    if (error) return fail(error);
    if (!row) return NextResponse.json({ success: false, message: 'Artist not found.' }, { status: 404 });

    const images = [row.cover_public_id, ...(songs || []).map((s) => s.cover_public_id)];
    const audio = (songs || []).map((s) => s.audio_public_id);
    await Promise.allSettled([
      ...[...new Set(images)].filter(isSongPlaylistAsset).map((pid) => deleteFromCloudinary(pid, 'image')),
      ...audio.filter(isSongPlaylistAsset).map((pid) => deleteFromCloudinary(pid, 'video')),
    ]);
    return NextResponse.json({ success: true, deletedSongs: (songs || []).length });
  } catch (error) {
    return fail(error);
  }
}
