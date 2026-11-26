import { cache } from 'react';
import { publishedVideosSafely } from '@/lib/serviceVideosServer';

// The /midweek pages: /midweek (the latest Midweek Service) and
// /midweek/<slug> (one service), drawn by components/services - the same
// page as /sunday-service. Both are cached and rebuilt the moment a video
// changes in the dashboard (revalidatePath('/midweek', 'layout')).

// One read of the list per page, shared by the page and its metadata.
export const videoList = cache(() => publishedVideosSafely());
