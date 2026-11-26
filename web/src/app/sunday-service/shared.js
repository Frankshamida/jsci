import { cache } from 'react';
import { publishedStreamsSafely } from '@/lib/sundayServiceServer';

// The /sunday-service pages: /sunday-service (the service live now, else the
// latest) and /sunday-service/<slug> (one service), drawn by
// components/services - the same page as /midweek. Both are cached and rebuilt
// the moment a stream changes in the dashboard
// (revalidatePath('/sunday-service', 'layout')); an open page also refreshes
// itself when a service goes live or ends.

// One read of the list per page, shared by the page and its metadata.
export const streamList = cache(() => publishedStreamsSafely());
