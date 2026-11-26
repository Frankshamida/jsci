import '../home.css';
import './news.css';
import { NEWS_CATEGORIES } from '@/lib/news';
import { NEWS_SORTS, categoryCounts, featuredList, publishedList, safely } from '@/lib/newsServer';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, absoluteUrl, siteOrigin } from '@/lib/socialCard';
import { NewsFollow, NewsHero } from '@/components/news/NewsChrome';
import { SiteFooter, SiteNavbar } from '@/components/SiteChrome';
import { FeaturedRow, NewsBrowser } from '@/components/news/NewsBrowser';
import GivingCard from '@/components/giving/GivingCard';
import { featuredCampaigns } from '@/lib/givingServer';

// /news - the church's news.
//
//   Featured stories   the ones an Admin featured (Dashboard > News), in one
//                      row; until something is featured, the newest three
//   All news           every story: search, topics, newest / most read /
//                      oldest, grid or list, load more
//
// ?category=, ?q= and ?sort= open the list already filtered (the list keeps
// the address up to date as the reader changes it), and are drawn on the
// server so the first page needs no waiting.

export const revalidate = 60;

const FIRST_PAGE = 12;

const filtersFrom = (searchParams) => ({
  category: NEWS_CATEGORIES.includes(searchParams?.category) ? searchParams.category : null,
  q: String(searchParams?.q || '').slice(0, 80).trim(),
  sort: NEWS_SORTS.includes(searchParams?.sort) ? searchParams.sort : 'newest',
});

export async function generateMetadata({ searchParams }) {
  const brand = brandFor(await readBranding());
  const { category } = filtersFrom(searchParams);
  const title = category ? `${category} · News · ${brand.name}` : `News · ${brand.name}`;
  const description = `News, stories and announcements from ${brand.church}, Cebu City.`;
  // A page's openGraph replaces the layout's whole, so the card picture has
  // to be named here too or a shared /news link goes out with none.
  const origin = siteOrigin();
  const image = absoluteUrl(DEFAULT_CARD_IMAGE, origin);
  return {
    title,
    description,
    alternates: { canonical: `${origin}/news` },
    openGraph: {
      type: 'website',
      siteName: brand.name,
      url: `${origin}/news`,
      title,
      description,
      images: [{ url: image, width: OG_WIDTH, height: OG_HEIGHT, type: 'image/jpeg', alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function NewsPage({ searchParams }) {
  const filters = filtersFrom(searchParams);
  const filtered = Boolean(filters.category || filters.q);
  const [{ articles, total }, featured, counts, appeals] = await Promise.all([
    safely(() => publishedList({ limit: FIRST_PAGE, ...filters }), { articles: [], total: 0 }),
    filtered ? Promise.resolve([]) : safely(() => featuredList({ limit: 8 }), []),
    safely(() => categoryCounts(), {}),
    safely(() => featuredCampaigns(), []),
  ]);
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);

  // Nothing featured yet: the newest three make the row, once there are
  // enough stories that it does not just repeat the list below.
  let row = featured;
  let latestRow = false;
  if (!filtered && !row.length && allCount > 4) {
    row = (await safely(() => publishedList({ limit: 3 }), { articles: [] })).articles;
    latestRow = true;
  }

  return (
    <div className="nw-page">
      <SiteNavbar current="news" />
      <NewsHero count={allCount} />

      <main className="nw-main">
        {allCount === 0 && !filtered ? (
          <div className="nw-wrap">
            <section className="nw-empty">
              <span className="nw-eyebrow">News</span>
              <h1>No news yet</h1>
              <p>Stories from the church will appear here soon.</p>
            </section>
          </div>
        ) : (
          <>
            <FeaturedRow articles={row} latest={latestRow} />
            <div className="nw-wrap">
              <NewsBrowser
                initial={articles}
                total={total}
                counts={counts}
                categories={NEWS_CATEGORIES}
                start={filters}
              />
            </div>
          </>
        )}
        <div className="nw-wrap">
          {/* A featured giving appeal, between the stories and the invitation to follow. */}
          {appeals[0] && <div className="nw-giving"><GivingCard campaign={appeals[0]} variant="inline" /></div>}
          <NewsFollow />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
