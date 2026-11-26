// The streams that are live right now, for the website's live page.
//
// Two ways out:
//   /api/live-streams/public   anyone: what is live (title, counts), never the
//                              video itself - enough for a "Live now" badge
//   /api/live-streams/watch    a signed-in account: the same list WITH the
//                              video, so the service plays only for people who
//                              have an account (a Guest account is enough)
//
// Both read one list, kept for 10 s, so a crowd opening the page at nine on
// Sunday costs one set of queries.
import { cached } from '@/lib/serverCache';
import { supabase } from '@/lib/supabase';

const LIST_TTL_MS = 10 * 1000;

async function loadStreams() {
  const { data, error } = await supabase
    .from('live_streams')
    .select('id, iframe_url, caption, title, posted_by_name, is_live, created_at')
    .eq('is_active', true)
    .eq('is_live', true)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return Promise.all((data || []).map(async (stream) => {
    const [{ count: reactionCount }, { count: commentCount }] = await Promise.all([
      supabase.from('live_stream_reactions').select('*', { count: 'exact', head: true }).eq('stream_id', stream.id),
      supabase.from('live_stream_comments').select('*', { count: 'exact', head: true }).eq('stream_id', stream.id),
    ]);
    return { ...stream, reactionCount: reactionCount || 0, commentCount: commentCount || 0 };
  }));
}

export function liveStreamsNow() {
  return cached('live-streams:now', LIST_TTL_MS, loadStreams);
}

// The list as a visitor without an account may see it: no video link.
export function withoutVideo(streams) {
  return streams.map(({ iframe_url: _video, ...rest }) => rest);
}
