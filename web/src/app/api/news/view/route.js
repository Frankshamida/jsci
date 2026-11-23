import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { clientIp, limit } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';

// POST /api/news/view  { id }
// One more reader. The page sends this once per visit (it remembers in the
// browser), and one address counts once per article per half hour, so
// refreshing does not inflate "Trending".
export async function POST(request) {
  try {
    const { id } = (await request.json().catch(() => null)) || {};
    if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) {
      return NextResponse.json({ success: false, message: 'Which article?' }, { status: 400 });
    }
    const gate = await limit(`news:view:${id}:${clientIp(request)}`, 1, 30 * 60 * 1000);
    if (!gate.allowed) return NextResponse.json({ success: true, counted: false });
    const { data, error } = await supabaseAdmin.rpc('news_article_viewed', { p_id: id });
    if (error) throw error;
    return NextResponse.json({ success: true, counted: true, views: data ?? null });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
