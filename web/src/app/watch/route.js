import { NextResponse } from 'next/server';
import { midweekPath } from '@/lib/serviceVideos';
import { publishedVideosSafely } from '@/lib/serviceVideosServer';

export const dynamic = 'force-dynamic';

// /watch was the first address of the service videos. Its links - shared,
// bookmarked, printed - keep working, as permanent (301) redirects:
//
//   /watch            -> /midweek
//   /watch?v=<uuid>   -> /midweek/<that video's slug>   (/midweek if it is gone)
export async function GET(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('v');
  let path = '/midweek';
  if (id) {
    const video = (await publishedVideosSafely()).find((v) => v.id === id);
    if (video) path = midweekPath(video.slug);
  }
  return NextResponse.redirect(new URL(path, url.origin), 301);
}
