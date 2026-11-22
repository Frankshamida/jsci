// The saved branding, read on the server.
//
// SERVER ONLY - it may use the service-role key.
//
// The root layout calls this so the very first HTML a visitor receives
// already carries the right name. Reading it in the browser instead would
// paint "Joyful Sound Church" and then swap it for "SanctuaryHub" a moment
// later, in the biggest heading on the page.
//
// It goes through Next's fetch cache on purpose, the same way the APK page
// reads its releases: the pages stay static, the value is fetched once and
// kept, and PUT /api/branding drops it with `revalidateTag` the moment a
// Super Admin changes it. The hour is only a safety net.

import { BRANDING_DEFAULT, BRANDING_KEY, BRANDING_TAG, normalizeBranding } from '@/lib/branding';

const REFRESH_SECONDS = 3600;

export async function readBranding() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ...BRANDING_DEFAULT };
  try {
    const res = await fetch(
      `${url}/rest/v1/system_settings?key=eq.${encodeURIComponent(BRANDING_KEY)}&select=value`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        next: { revalidate: REFRESH_SECONDS, tags: [BRANDING_TAG] },
      },
    );
    if (!res.ok) return { ...BRANDING_DEFAULT };
    const rows = await res.json();
    // No row is the normal state of a site that has never touched this.
    return Array.isArray(rows) && rows[0] ? normalizeBranding(rows[0].value) : { ...BRANDING_DEFAULT };
  } catch {
    // The page must render whatever happens here, and the church is the default.
    return { ...BRANDING_DEFAULT };
  }
}
