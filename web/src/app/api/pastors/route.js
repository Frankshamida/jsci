import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';
import { parsePastorTitles } from '@/lib/userRoles';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// GET /api/pastors - "Our Pastors" on the website and the dashboard's Home:
// the Pastor accounts marked to be shown there (users.website_order), in
// that order: name (with Dr. / Ptr.), title and photo. Nothing else about
// them. Public; a minute at the edge.
//
// Until supabase/migrations/pastors_on_website.sql has been run the columns
// are not there: { fallback: true }, and the pages keep their own list.
// ============================================================

const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' };
const missingColumn = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /website_order|name_prefix/.test(String(e.message || '')));

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('users')
      .select('id, firstname, lastname, name_prefix, sub_role, profile_picture, role, additional_roles, is_active, website_order')
      .not('website_order', 'is', null)
      .order('website_order', { ascending: true });
    if (error) {
      if (missingColumn(error)) return NextResponse.json({ success: true, fallback: true, pastors: [] }, { headers });
      throw error;
    }
    const pastors = (data || [])
      .filter((u) => u.is_active !== false && getUserRoles(u).includes('Pastor'))
      .map((u) => ({
        id: u.id,
        name: [u.name_prefix || 'Ptr.', u.firstname, u.lastname].filter(Boolean).join(' '),
        title: parsePastorTitles(u.sub_role)[0] || 'Pastor',
        photo: u.profile_picture || null,
      }));
    return NextResponse.json({ success: true, fallback: false, pastors }, { headers });
  } catch (error) {
    console.error('pastors:', error?.message || error);
    // The pages keep their own list rather than show nobody.
    return NextResponse.json({ success: false, fallback: true, pastors: [] }, { status: 200, headers });
  }
}
