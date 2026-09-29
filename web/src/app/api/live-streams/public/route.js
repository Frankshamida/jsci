import { NextResponse } from 'next/server';
import { cached } from '@/lib/serverCache';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Everyone watching the live page asks for the same list at the same moment.
// The CDN answers repeats for 10 s, and serverCache collapses the misses that
// get through into one set of queries. Realtime still tells the page to refresh.
const LIST_TTL_MS = 10 * 1000;
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=30' };

// GET - Public endpoint: Fetch active live streams (no auth required)
export async function GET() {
  try {
    const streamsWithCounts = await cached('live-streams:public', LIST_TTL_MS, loadStreams);
    return NextResponse.json(streamsWithCounts, { headers: CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function loadStreams() {
  const { data, error } = await supabase
    .from('live_streams')
    .select('id, iframe_url, caption, title, posted_by_name, is_live, created_at')
    .eq('is_active', true)
    .eq('is_live', true)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Get reaction and comment counts
  const streamsWithCounts = await Promise.all(
    (data || []).map(async (stream) => {
      const { count: reactionCount } = await supabase
        .from('live_stream_reactions')
        .select('*', { count: 'exact', head: true })
        .eq('stream_id', stream.id);

      const { count: commentCount } = await supabase
        .from('live_stream_comments')
        .select('*', { count: 'exact', head: true })
        .eq('stream_id', stream.id);

      return {
        ...stream,
        reactionCount: reactionCount || 0,
        commentCount: commentCount || 0,
      };
    })
  );

  return streamsWithCounts;
}
