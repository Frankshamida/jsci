// Which homepage sections show - read by everybody, written by a Super Admin.
//
// GET is open: a short list of section keys, which System Configuration reads
// to show what is saved. PUT is checked against the account's role on the
// server (requireRole with no roles: a Super Admin only), because the role a
// browser claims to have is not evidence of anything.

import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { HOME_SECTIONS, HOME_SECTIONS_KEY, HOME_SECTIONS_TAG, normalizeHomeSections } from '@/lib/homeSections';

export const dynamic = 'force-dynamic';
// supabase-js goes through Next's caching fetch; this must answer with what
// is in the table right now.
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('system_settings').select('value').eq('key', HOME_SECTIONS_KEY).maybeSingle();
    const setting = normalizeHomeSections(error || !data ? null : data.value);
    return NextResponse.json({ success: true, data: setting }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ success: true, data: normalizeHomeSections(null), degraded: true });
  }
}

export async function PUT(request) {
  const body = (await request.json().catch(() => null)) || {};
  // A Super Admin only (requireRole lets a Super Admin through any list).
  const who = await requireRole(body.actorId, []);
  if (who.error) {
    return NextResponse.json({
      success: false,
      message: who.status === 403 ? 'Access denied. Only a Super Admin can choose the homepage sections.' : who.error,
    }, { status: who.status });
  }
  const value = normalizeHomeSections({ hidden: body.hidden });
  try {
    const { error } = await supabaseAdmin.from('system_settings').upsert({
      key: HOME_SECTIONS_KEY,
      value,
      description: 'Homepage sections hidden by a Super Admin (System Configuration > Homepage Sections).',
      updated_by: who.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (error) throw error;

    // Every page's HTML carries the setting (the root layout reads it, for the
    // menu and the footer), so the cached setting and the pages built from it go.
    revalidateTag(HOME_SECTIONS_TAG);
    revalidatePath('/', 'layout');

    try {
      const names = HOME_SECTIONS.filter((s) => value.hidden.includes(s.key)).map((s) => s.label);
      await supabaseAdmin.from('audit_logs').insert({
        user_id: who.user.id,
        user_name: who.name,
        action: 'update',
        resource: 'system_setting',
        resource_id: HOME_SECTIONS_KEY,
        details: names.length ? `Homepage sections hidden: ${names.join(', ')}` : 'Every homepage section shown',
      });
    } catch { /* the setting is saved; the log is not worth failing over */ }

    return NextResponse.json({ success: true, data: value, message: 'Homepage sections saved' });
  } catch (error) {
    console.error('home-sections PUT:', error?.message || error);
    return NextResponse.json({ success: false, message: 'The homepage sections could not be saved. Please try again.' }, { status: 500 });
  }
}
