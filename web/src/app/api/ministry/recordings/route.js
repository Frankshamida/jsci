import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf, internalJson } from '@/lib/ministryAuth';
import { shapeLineup } from '@/lib/ministryApp';
import { GET as listRecordings, POST as uploadRecording, DELETE as deleteRecording } from '@/app/api/practice-recordings/route';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
// Vercel stops request bodies at 4.5 MB; the app records small AAC files well under it.
const MAX_BYTES = 4.4 * 1024 * 1024;
const SONG_TYPES = ['Slow Song', 'Fast Song'];

// GET - Practice recordings of a lineup: ?scheduleId=
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const scheduleId = new URL(request.url).searchParams.get('scheduleId');
  if (!scheduleId) return bad('scheduleId is required.');
  return listRecordings(internalJson(`/api/practice-recordings?schedule_id=${encodeURIComponent(scheduleId)}`, 'GET'));
}

// POST - Upload a practice recording (multipart): file, scheduleId, songType, title.
// Anybody on that lineup can add one; it is stored with the website's recordings.
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const form = await request.formData();
  const file = form.get('file');
  const scheduleId = form.get('scheduleId');
  const songType = form.get('songType');
  const title = String(form.get('title') || '').trim();
  if (!file || typeof file === 'string') return bad('Choose a recording to upload.');
  if (file.size > MAX_BYTES) return bad('That recording is too large (over 4.4 MB). Keep it under 10 minutes.');
  if (!String(file.type || '').startsWith('audio/') && !/\.(m4a|aac|mp3|wav|ogg|webm|caf)$/i.test(file.name || '')) return bad('Only audio files can be uploaded.');
  if (!SONG_TYPES.includes(songType)) return bad('Choose Slow Song or Fast Song.');
  if (!title) return bad('Give the recording a title.');

  const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_id', scheduleId).maybeSingle();
  if (!schedule) return bad('Lineup not found.', 404);
  if (!shapeLineup(schedule, user, {}).mine) return bad('You can add recordings to your own lineups only.', 403);

  const out = new FormData();
  out.append('file', file, file.name || `practice-${Date.now()}.m4a`);
  out.append('schedule_id', schedule.schedule_id);
  out.append('schedule_date', schedule.schedule_date);
  out.append('song_type', songType);
  out.append('title', title.slice(0, 120));
  out.append('recorded_by', user.id);
  out.append('recorded_by_name', fullNameOf(user));
  return uploadRecording(new Request('http://ministry.internal/api/practice-recordings', { method: 'POST', body: out }));
}

// DELETE - Remove one of your own recordings: ?id=
export async function DELETE(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  const { data: rec } = await supabase.from('practice_recordings').select('id, recorded_by').eq('id', id).maybeSingle();
  if (!rec || rec.recorded_by !== auth.user.id) return bad('Recording not found.', 404);
  return deleteRecording(internalJson(`/api/practice-recordings?id=${encodeURIComponent(id)}`, 'DELETE'));
}
