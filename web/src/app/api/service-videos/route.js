import { NextResponse } from 'next/server';
import { publicVideo, publishedVideos, videosTableMissing } from '@/lib/serviceVideosServer';

// Asked each time (the list is kept 20 s in lib/serviceVideosServer and at the
// CDN), not drawn once when the site is built.
export const dynamic = 'force-dynamic';
// Every read fresh. On its own, force-dynamic does not stop Next 14 from
// keeping the database reads of a GET-only route in its data cache for good.
export const revalidate = 0;

// GET - the service videos on /midweek, for anyone: titles, dates, speakers,
// slugs and thumbnail templates. Never the video itself; that is
// /api/service-videos/watch, for an account.
export async function GET() {
  try {
    const videos = (await publishedVideos()).map(publicVideo);
    return NextResponse.json(videos, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=40' },
    });
  } catch (error) {
    if (videosTableMissing(error)) return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
