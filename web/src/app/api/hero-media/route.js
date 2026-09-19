// What the public hero shows - read by everybody, written by an Admin.
//
// GET is deliberately open and cached hard: the home page asks for this on
// every visit, before it can draw the hero, and the answer is three short
// strings that change perhaps twice a year. PUT is the admin's toggle and is
// checked against the user's role on the server, because the role the browser
// claims to have is not evidence of anything.

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cacheInvalidate, cached } from '@/lib/serverCache';
import {
  HERO_MEDIA_DEFAULT, HERO_MEDIA_KEY, HERO_MODES, isSafeVideoName, normalizeHeroMedia,
} from '@/lib/heroMedia';

// Without this Next sees a GET that touches no request data and prerenders it
// at build time - which would freeze the answer at whatever the setting was
// when the site was deployed, and an admin's change would never appear. The
// Cache-Control below is what keeps it cheap instead.
export const dynamic = 'force-dynamic';

// And this is the other half, which is much less obvious.
//
// Next replaces global `fetch` on the server with a caching one, and
// supabase-js makes its queries through exactly that. So a PostgREST response
// can be served out of Next's data cache in `.next/cache` - across requests,
// and across builds - no matter what this route says about being dynamic.
// The symptom was a query that returned `error: null, data: null` here while
// the identical query from a plain script returned the row: what came back was
// a cached answer from before the row existed.
export const fetchCache = 'force-no-store';

const HERO_ADMIN_ROLES = ['Admin', 'Super Admin'];
const CACHE_KEY = 'hero:media';
// Short, because this is a setting somebody changes and then immediately goes
// and looks at. It only exists to collapse a burst of visitors into one query,
// which ten seconds does just as well as sixty. On a host running several
// instances, `cacheInvalidate` in PUT only clears the one that handled the
// write, so this number is also the worst case for the others catching up.
const CACHE_TTL_MS = 10_000;

async function readHeroMedia() {
  return cached(CACHE_KEY, CACHE_TTL_MS, async () => {
    if (!supabase) return { ...HERO_MEDIA_DEFAULT };
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', HERO_MEDIA_KEY)
      .maybeSingle();
    // No row yet is the normal state of a site that has never touched this,
    // and it means the carousel - not an error.
    if (error || !data) return { ...HERO_MEDIA_DEFAULT };
    return normalizeHeroMedia(data.value);
  });
}

export async function GET() {
  try {
    const media = await readHeroMedia();
    return NextResponse.json({ success: true, data: media }, {
      headers: {
        // `max-age=0` is the important part, and it was wrong here to begin
        // with. Any browser caching at all means an admin who saves and then
        // reloads is served their own stale copy and sees the change undone -
        // which is precisely what it looked like: a setting that would not
        // stick, when the database had it all along.
        //
        // `s-maxage` is a different thing and stays: it caches at the CDN, not
        // in the visitor's browser, so a burst of traffic still collapses to
        // one query, and a purge is only ever ten seconds away.
        'Cache-Control': 'public, max-age=0, must-revalidate, s-maxage=10, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    // The hero must render whatever happens here, so a failure answers with
    // the default rather than a status the page then has to handle.
    return NextResponse.json({ success: true, data: { ...HERO_MEDIA_DEFAULT }, degraded: true });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { actorId, mode, desktop, mobile } = body || {};

    if (!actorId) {
      return NextResponse.json({ success: false, message: 'Not signed in.' }, { status: 401 });
    }
    const { data: actor } = await supabase
      .from('users').select('id, role').eq('id', String(actorId)).single();
    if (!actor || !HERO_ADMIN_ROLES.includes(actor.role)) {
      return NextResponse.json({
        success: false,
        message: 'Access denied. Only Admins and Super Admins can change the hero section.',
      }, { status: 403 });
    }

    if (!HERO_MODES.includes(mode)) {
      return NextResponse.json({ success: false, message: 'Choose either the image carousel or a video.' }, { status: 400 });
    }
    // An empty box means "not set", which is allowed. A name that is set has to
    // be one we would actually serve - see isSafeVideoName.
    for (const [which, name] of [['desktop', desktop], ['mobile', mobile]]) {
      if (name && !isSafeVideoName(name)) {
        return NextResponse.json({
          success: false,
          message: `That ${which} file name is not a video in the Videos folder.`,
        }, { status: 400 });
      }
    }
    if (mode === 'video' && !desktop && !mobile) {
      return NextResponse.json({
        success: false,
        message: 'Pick a video for desktop or mobile before switching the hero to video.',
      }, { status: 400 });
    }

    const value = {
      mode,
      desktop: desktop ? String(desktop).trim() : '',
      mobile: mobile ? String(mobile).trim() : '',
    };

    // A real JSONB object, not a string holding one. `normalizeHeroMedia`
    // reads both, so the older admin endpoint writing the same key by hand
    // would still be understood.
    const { error } = await supabase.from('system_settings').upsert({
      key: HERO_MEDIA_KEY,
      value,
      description: 'Public hero section: image carousel, or a looping video per viewport.',
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (error) throw error;

    cacheInvalidate(CACHE_KEY);

    try {
      await supabase.from('audit_logs').insert({
        user_id: actor.id,
        action: 'update',
        resource: 'system_setting',
        resource_id: HERO_MEDIA_KEY,
        details: `Hero section set to ${value.mode}`
          + (value.mode === 'video' ? ` (desktop: ${value.desktop || '-'}, mobile: ${value.mobile || '-'})` : ''),
      });
    } catch { /* the setting is saved; the log is not worth failing over */ }

    return NextResponse.json({ success: true, data: value, message: 'Hero section updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
