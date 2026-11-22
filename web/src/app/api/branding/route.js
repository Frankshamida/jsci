// Whose name the public site wears - read by everybody, written by a Super Admin.
//
// GET is open: it is one word, and the System Configuration card reads it to
// show what is saved. PUT is checked against the user's role on the server,
// because the role a browser claims to have is not evidence of anything - the
// same rule as the hero-media switch next to it.

import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { BRAND_MODES, BRANDING_KEY, BRANDING_TAG, brandFor, normalizeBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';
// See api/hero-media: supabase-js queries go through Next's caching fetch, and
// this route must always answer with what is in the table right now.
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('system_settings').select('value').eq('key', BRANDING_KEY).maybeSingle();
    const setting = error || !data ? normalizeBranding(null) : normalizeBranding(data.value);
    return NextResponse.json({ success: true, data: setting }, {
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate, s-maxage=10, stale-while-revalidate=60' },
    });
  } catch {
    return NextResponse.json({ success: true, data: normalizeBranding(null), degraded: true });
  }
}

export async function PUT(request) {
  try {
    const { actorId, mode } = (await request.json()) || {};

    if (!actorId) {
      return NextResponse.json({ success: false, message: 'Not signed in.' }, { status: 401 });
    }
    const { data: actor } = await supabase
      .from('users').select('id, role').eq('id', String(actorId)).single();
    if (!actor || actor.role !== 'Super Admin') {
      return NextResponse.json({
        success: false,
        message: 'Access denied. Only a Super Admin can change the site branding.',
      }, { status: 403 });
    }

    if (!BRAND_MODES.includes(mode)) {
      return NextResponse.json({ success: false, message: 'Choose the church name or SanctuaryHub.' }, { status: 400 });
    }

    const value = { mode };
    const { error } = await supabase.from('system_settings').upsert({
      key: BRANDING_KEY,
      value,
      description: 'Public branding: the church name, or the SanctuaryHub platform name.',
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (error) throw error;

    // Every page's HTML carries the name (the root layout reads it), so the
    // cached copy of the setting and of the pages built from it both go.
    revalidateTag(BRANDING_TAG);
    revalidatePath('/', 'layout');

    try {
      await supabase.from('audit_logs').insert({
        user_id: actor.id,
        action: 'update',
        resource: 'system_setting',
        resource_id: BRANDING_KEY,
        details: `Site branding set to ${brandFor(value).full}`,
      });
    } catch { /* the setting is saved; the log is not worth failing over */ }

    return NextResponse.json({ success: true, data: value, message: 'Branding updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message || 'Could not save the branding.' }, { status: 500 });
  }
}
