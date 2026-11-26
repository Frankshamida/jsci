import { NextResponse } from 'next/server';
import { liveStreamsNow } from '@/lib/liveStreams';
import { watchableStream } from '@/lib/sundayServiceServer';
import { NO_STORE, checkWatcher, isUuid } from '@/lib/watchAccess';

export const dynamic = 'force-dynamic';

// For a signed-in account (a Guest one is enough; a deactivated one is not -
// lib/watchAccess):
//
//   POST { userId, id }   one Sunday Service's player: { id, src, link }
//   POST { userId }       the streams live now, WITH the player
export async function POST(request) {
  try {
    const { userId, id } = await request.json().catch(() => ({}));
    const access = await checkWatcher(userId, 'Please sign in to watch the Sunday Service.');
    if (!access.ok) return NextResponse.json(access.body, { status: access.status, headers: NO_STORE });

    if (id !== undefined) {
      const stream = isUuid(id) ? await watchableStream(id) : null;
      if (!stream?.src) {
        return NextResponse.json({ error: 'not-found', message: 'This service is no longer on the website.' }, { status: 404, headers: NO_STORE });
      }
      return NextResponse.json(stream, { headers: NO_STORE });
    }

    const streams = await liveStreamsNow();
    return NextResponse.json(streams, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  }
}
