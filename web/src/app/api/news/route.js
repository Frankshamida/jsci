import { NextResponse } from 'next/server';
import { NEWS_CATEGORIES } from '@/lib/news';
import { newsTableMissing, publishedList } from '@/lib/newsServer';

export const dynamic = 'force-dynamic';

// GET /api/news?limit=&offset=&category=
// Published articles, newest first - for the home page's "From the News" strip
// and the News page's "Load more". No body text, just what a card shows.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit'), 10) || 12));
    const offset = Math.max(0, parseInt(searchParams.get('offset'), 10) || 0);
    const category = NEWS_CATEGORIES.includes(searchParams.get('category')) ? searchParams.get('category') : null;
    const { articles, total } = await publishedList({ limit, offset, category });
    return NextResponse.json({ success: true, data: articles, total }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' },
    });
  } catch (error) {
    if (newsTableMissing(error)) return NextResponse.json({ success: true, data: [], total: 0 });
    return NextResponse.json({ success: false, message: error.message || 'Could not load the news.' }, { status: 500 });
  }
}
