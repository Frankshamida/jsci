import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { canEditLyrics } from '@/lib/ministryApp';
import { formatLyrics, matchLyrics, sectionsOf, videoIdOf } from '@/lib/ministryLyrics';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const shape = (row) => ({
  id: row.id,
  title: row.title,
  artist: row.artist || null,
  link: row.youtube_link || null,
  sections: sectionsOf(row),
  preparedBy: row.prepared_by_name || null,
  updatedAt: row.updated_at,
});

// GET - The lyrics of a lineup's songs: ?scheduleId=
//   { date, songs: [{ type: 'Fast Song' | 'Slow Song', title, link, lyrics: {...} | null }] }
// Fast songs first, the order they are sung.
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const scheduleId = new URL(request.url).searchParams.get('scheduleId');
  const { data: schedule } = await supabase.from('schedules').select('schedule_date, slow_songs, fast_songs').eq('schedule_id', scheduleId).maybeSingle();
  if (!schedule) return bad('Lineup not found.', 404);

  const songs = [
    ...(schedule.fast_songs || []).map((s) => ({ type: 'Fast Song', title: s.title, link: s.link || '' })),
    ...(schedule.slow_songs || []).map((s) => ({ type: 'Slow Song', title: s.title, link: s.link || '' })),
  ].filter((s) => s.title);

  // The library's index is small (no lyrics): match on it, then read only the matches.
  const { data: index, error } = await supabase.from('lyrics_library').select('id, title, youtube_link, status, linked_schedule_dates, updated_at');
  if (error) {
    console.error('GET /api/ministry/lyrics error:', error);
    return bad('Could not load the lyrics. Try again.', 500);
  }
  const matches = songs.map((s) => matchLyrics(s, index || [], schedule.schedule_date));
  const ids = [...new Set(matches.filter(Boolean).map((m) => m.id))];
  const { data: full } = ids.length
    ? await supabase.from('lyrics_library').select('id, title, artist, youtube_link, sections, lyrics_plain, lyrics_html, prepared_by_name, updated_at').in('id', ids)
    : { data: [] };
  const byId = Object.fromEntries((full || []).map((r) => [r.id, r]));

  return NextResponse.json({
    success: true,
    data: {
      date: schedule.schedule_date,
      canEdit: canEditLyrics(auth.user),
      songs: songs.map((s, i) => ({ ...s, lyrics: matches[i] && byId[matches[i].id] ? shape(byId[matches[i].id]) : null })),
    },
  });
}

// PUT - The Media team writes a song's lyrics: { id?, title, link?, text, scheduleDate? }.
// With an id it updates that library entry; without, it adds one.
export async function PUT(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;
  if (!canEditLyrics(user)) return bad('Only the Media team can write lyrics.', 403);

  const { id, title, link, text, scheduleDate } = await request.json();
  const name = String(title || '').trim().slice(0, 150);
  if (!name) return bad('The song needs a title.');
  const { sections, html, plain } = formatLyrics(String(text || '').slice(0, 20000));
  if (!sections.length) return bad('Type or paste the lyrics first.');
  const youtube = videoIdOf(link) ? String(link).trim().slice(0, 300) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(scheduleDate || '')) ? scheduleDate : null;

  const fields = { sections, lyrics_html: html, lyrics_plain: plain, status: 'Published', prepared_by: user.id, prepared_by_name: fullNameOf(user) };
  let saved;
  if (id) {
    const { data: row } = await supabase.from('lyrics_library').select('id, youtube_link, linked_schedule_dates').eq('id', id).maybeSingle();
    if (!row) return bad('Those lyrics were removed. Save them again as new.', 404);
    const linked = [...new Set([...(row.linked_schedule_dates || []), ...(date ? [date] : [])])];
    const { data, error } = await supabase.from('lyrics_library')
      .update({ ...fields, title: name, youtube_link: row.youtube_link || youtube, linked_schedule_dates: linked })
      .eq('id', id).select().single();
    if (error) return bad('Could not save the lyrics. Try again.', 500);
    saved = data;
  } else {
    const { data, error } = await supabase.from('lyrics_library')
      .insert({ ...fields, title: name, youtube_link: youtube, language: 'English', linked_schedule_dates: date ? [date] : [] })
      .select().single();
    if (error) return bad('Could not save the lyrics. Try again.', 500);
    saved = data;
  }
  return NextResponse.json({ success: true, message: 'Lyrics saved. The whole team sees them now.', data: shape(saved) });
}
