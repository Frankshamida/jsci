import { NextResponse } from 'next/server';
import { liveStreamsNow, withoutVideo } from '@/lib/liveStreams';

export const dynamic = 'force-dynamic';

// Everyone asks for the same list at the same moment. The CDN answers repeats
// for 10 s, and liveStreamsNow() collapses the misses that get through into
// one set of queries. Realtime still tells the page to refresh.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=30' };

// GET - what is live right now, for anyone: the title and the counts, enough
// for a "Live now" badge. The video itself is only handed to a signed-in
// account, by /api/live-streams/watch.
export async function GET() {
  try {
    const streams = await liveStreamsNow();
    return NextResponse.json(withoutVideo(streams), { headers: CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
