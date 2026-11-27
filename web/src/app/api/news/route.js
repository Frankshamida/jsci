import { NextResponse } from 'next/server';
import { NEWS_CATEGORIES } from '@/lib/news';
import { NEWS_SORTS, featuredList, newsTableMissing, publishedList } from '@/lib/newsServer';

export const dynamic = 'force-dynamic';
// Every read fresh. On its own, force-dynamic does not stop Next 14 from
// keeping the database reads of a GET-only route in its data cache for good.
export const revalidate = 0;

// GET /api/news?limit=&offset=&category=&q=&sort=
// GET /api/news?limit=&featured=1   the featured stories first, then the
//                                   newest to fill (the landing page)
// Published articles - for the home page's "From the News" strip, the News
// page's list (search, topic, order, load more) and "More news" under an
// article. sort: newest (the default), popular, oldest. No body text, just
// what a card shows.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit'), 10) || 12));
    const offset = Math.max(0, parseInt(searchParams.get('offset'), 10) || 0);
    const category = NEWS_CATEGORIES.includes(searchParams.get('category')) ? searchParams.get('category') : null;
    if (searchParams.get('featured') === '1') {
      const featured = await featuredList({ limit });
      const { articles: newest, total } = await publishedList({ limit: limit + featured.length });
      const seen = new Set(featured.map((a) => a.id));
      const data = [...featured, ...newest.filter((a) => !seen.has(a.id))].slice(0, limit);
      return NextResponse.json({ success: true, data, total }, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' },
      });
    }
    const q = String(searchParams.get('q') || '').slice(0, 80);
    const sort = NEWS_SORTS.includes(searchParams.get('sort')) ? searchParams.get('sort') : 'newest';
    const { articles, total } = await publishedList({ limit, offset, category, q, sort });
    return NextResponse.json({ success: true, data: articles, total }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' },
    });
  } catch (error) {
    if (newsTableMissing(error)) return NextResponse.json({ success: true, data: [], total: 0 });
    return NextResponse.json({ success: false, message: error.message || 'Could not load the news.' }, { status: 500 });
  }
}
