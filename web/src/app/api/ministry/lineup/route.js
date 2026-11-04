import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, internalJson } from '@/lib/ministryAuth';
import { shapeLineup } from '@/lib/ministryApp';
import { PUT as updateSchedule } from '@/app/api/schedules/route';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const MAX_SONGS = 10;

// Songs as saved: a title, an optional YouTube (or any https) link, notes.
function cleanSongs(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_SONGS).map((s) => ({
    title: String(s?.title || '').trim().slice(0, 120),
    link: /^https?:\/\//i.test(String(s?.link || '').trim()) ? String(s.link).trim().slice(0, 300) : '',
    instructions: String(s?.instructions || '').trim().slice(0, 300),
  })).filter((s) => s.title);
}

// PUT - The Song Leader of a lineup sets its songs: { scheduleId, slowSongs, fastSongs }.
// Only the songs change; the people on the lineup stay as plotted.
export async function PUT(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;

  const { scheduleId, slowSongs, fastSongs } = await request.json();
  const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_id', scheduleId).maybeSingle();
  if (!schedule) return bad('Lineup not found.', 404);
  if (!shapeLineup(schedule, auth.user, {}).isSongLeader) return bad('Only the Song Leader of this lineup can set its songs.', 403);

  const slow = cleanSongs(slowSongs);
  const fast = cleanSongs(fastSongs);
  if (!slow.length && !fast.length) return bad('Add at least one song.');

  return updateSchedule(internalJson('/api/schedules', 'PUT', { scheduleId, slowSongs: slow, fastSongs: fast }));
}
