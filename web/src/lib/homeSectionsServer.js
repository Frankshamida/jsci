// The homepage sections a Super Admin hid, read on the server.
//
// SERVER ONLY - it may use the service-role key.
//
// The root layout calls this, like readBranding next to it, so the first
// HTML a visitor receives already leaves a hidden section out: nothing is
// drawn and then taken away. It goes through Next's fetch cache, and
// PUT /api/home-sections drops it with `revalidateTag` the moment a Super
// Admin saves; the hour is only a safety net.

import { HOME_SECTIONS_KEY, HOME_SECTIONS_TAG, normalizeHomeSections } from '@/lib/homeSections';

const REFRESH_SECONDS = 3600;

export async function readHomeSections() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return normalizeHomeSections(null);
  try {
    const res = await fetch(
      `${url}/rest/v1/system_settings?key=eq.${encodeURIComponent(HOME_SECTIONS_KEY)}&select=value`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        next: { revalidate: REFRESH_SECONDS, tags: [HOME_SECTIONS_TAG] },
      },
    );
    if (!res.ok) return normalizeHomeSections(null);
    const rows = await res.json();
    // No row: nothing has ever been hidden.
    return normalizeHomeSections(Array.isArray(rows) && rows[0] ? rows[0].value : null);
  } catch {
    // The page must render whatever happens here: everything shown.
    return normalizeHomeSections(null);
  }
}
