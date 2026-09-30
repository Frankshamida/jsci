import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { PROGRAMME_KINDS } from '@/lib/eventPublic';
import { songsForIds, warmSongRenditions } from '@/lib/songPlaylist';

// The programme flow of an event - what the public page shows by default.
// See supabase/migrations/event_public_page.sql. A Worship item can carry
// songs from the Song Playlist (event_programme_songs.sql).

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

const missingSongsColumn = (error) => /song_ids/i.test(error?.message || '');

const explain = (error) => {
  const msg = error?.message || '';
  if (missingSongsColumn(error)) return 'Songs on Worship items need their migration: run supabase/migrations/event_programme_songs.sql in the Supabase SQL editor, then try again.';
  if (/event_programme/i.test(msg)) return 'The programme needs its migration: run supabase/migrations/event_public_page.sql in the Supabase SQL editor, then try again.';
  return msg || 'Something went wrong';
};

const BASE_FIELDS = 'id, event_id, day_date, start_time, end_time, title, speaker, kind, venue, notes, created_at, updated_at';
const FIELDS = `${BASE_FIELDS}, song_ids`;
const MAX_SONGS = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Distinct ids, in the order given. Only a Worship item keeps songs.
const readSongIds = (value, kind) => (kind === 'worship' && Array.isArray(value)
  ? [...new Set(value.map(String).filter((id) => UUID.test(id)))].slice(0, MAX_SONGS)
  : []);

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max) || null;
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const time = (v) => {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

// Writes the row; before event_programme_songs.sql an item without songs is
// still saved (the column is left out), and one with songs says to migrate.
async function withoutSongsIfUnmigrated(row, write) {
  const result = await write(row, FIELDS);
  if (!result.error || !missingSongsColumn(result.error) || row.song_ids.length) return result;
  const { song_ids: _unused, ...rest } = row; // eslint-disable-line no-unused-vars
  return write(rest, BASE_FIELDS);
}

// Makes sure each song's streaming copy exists on Cloudinary now, while one
// Admin is saving, rather than when a whole room presses play at once.
async function warmSongs(ids) {
  if (!ids?.length) return;
  try { await warmSongRenditions(await songsForIds(supabaseAdmin, ids)); } catch { /* best effort */ }
}

// The row as it may be written, or { error } saying what is missing.
function readItem(body) {
  const row = {
    day_date: date(body.dayDate),
    start_time: time(body.startTime),
    end_time: time(body.endTime),
    title: clean(body.title),
    speaker: clean(body.speaker),
    kind: PROGRAMME_KINDS.some((k) => k.key === body.kind) ? body.kind : 'session',
    venue: clean(body.venue),
    notes: clean(body.notes, 1000),
  };
  row.song_ids = readSongIds(body.songIds, row.kind);
  if (!row.title) return { error: 'Give the item a title.' };
  if (!row.day_date) return { error: 'Pick the day.' };
  if (!row.start_time) return { error: 'Set the start time.' };
  if (row.end_time && row.end_time <= row.start_time) return { error: 'The end time has to be after the start time.' };
  return { row };
}

// GET /api/events/programme?eventId=..
export async function GET(request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
    const list = (fields) => supabaseAdmin
      .from('event_programme')
      .select(fields)
      .eq('event_id', eventId)
      .order('day_date', { ascending: true })
      .order('start_time', { ascending: true });
    let { data, error } = await list(FIELDS);
    // Before event_programme_songs.sql: the programme still lists, without songs.
    if (error && missingSongsColumn(error)) ({ data, error } = await list(BASE_FIELDS));
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// POST /api/events/programme  { eventId, actorId, dayDate, startTime, endTime, title, speaker, kind, venue, notes }
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!body.eventId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });

    const { row, error: invalid } = readItem(body);
    if (invalid) return NextResponse.json({ success: false, message: invalid }, { status: 400 });

    const { data, error } = await withoutSongsIfUnmigrated(row, (r, fields) => supabaseAdmin
      .from('event_programme')
      .insert({ ...r, event_id: body.eventId, created_by: actor.id })
      .select(fields)
      .single());
    if (error) throw error;
    await warmSongs(row.song_ids);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// PUT /api/events/programme  { id, actorId, ...same fields }
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!body.id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { row, error: invalid } = readItem(body);
    if (invalid) return NextResponse.json({ success: false, message: invalid }, { status: 400 });

    const { data, error } = await withoutSongsIfUnmigrated(row, (r, fields) => supabaseAdmin
      .from('event_programme')
      .update(r)
      .eq('id', body.id)
      .select(fields)
      .single());
    if (error) throw error;
    await warmSongs(row.song_ids);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}

// DELETE /api/events/programme?id=..&actorId=..
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { error } = await supabaseAdmin.from('event_programme').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: explain(error) }, { status: 500 });
  }
}
