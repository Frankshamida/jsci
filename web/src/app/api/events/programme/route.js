import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { PROGRAMME_KINDS } from '@/lib/eventPublic';

// The programme flow of an event - what the public page shows by default.
// See supabase/migrations/event_public_page.sql.

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

const explain = (error) => (/event_programme/i.test(error?.message || '')
  ? 'The programme needs its migration: run supabase/migrations/event_public_page.sql in the Supabase SQL editor, then try again.'
  : (error?.message || 'Something went wrong'));

const FIELDS = 'id, event_id, day_date, start_time, end_time, title, speaker, kind, venue, notes, created_at, updated_at';

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max) || null;
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const time = (v) => {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

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
    const { data, error } = await supabaseAdmin
      .from('event_programme')
      .select(FIELDS)
      .eq('event_id', eventId)
      .order('day_date', { ascending: true })
      .order('start_time', { ascending: true });
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

    const { data, error } = await supabaseAdmin
      .from('event_programme')
      .insert({ ...row, event_id: body.eventId, created_by: actor.id })
      .select(FIELDS)
      .single();
    if (error) throw error;
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

    const { data, error } = await supabaseAdmin
      .from('event_programme')
      .update(row)
      .eq('id', body.id)
      .select(FIELDS)
      .single();
    if (error) throw error;
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
