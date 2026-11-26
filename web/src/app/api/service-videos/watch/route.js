import { NextResponse } from 'next/server';
import { watchableVideo } from '@/lib/serviceVideosServer';
import { NO_STORE, checkWatcher, isUuid } from '@/lib/watchAccess';

export const dynamic = 'force-dynamic';

// POST { userId, id } - one service video's address, for a signed-in account
// (a Guest one is enough; a deactivated one is not - lib/watchAccess).
export async function POST(request) {
  try {
    const { userId, id } = await request.json().catch(() => ({}));
    const access = await checkWatcher(userId, 'Please sign in to watch this service.');
    if (!access.ok) return NextResponse.json(access.body, { status: access.status, headers: NO_STORE });

    const video = isUuid(id) ? await watchableVideo(id) : null;
    if (!video) {
      return NextResponse.json({ error: 'not-found', message: 'This video is no longer on the website.' }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ id: video.id, video_url: video.video_url }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  }
}
