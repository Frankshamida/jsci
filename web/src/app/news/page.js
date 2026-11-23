import Link from 'next/link';
import '../home.css';
import './news.css';
import { NEWS_CATEGORIES, articlePath, newsDate, newsImage, timeAgo } from '@/lib/news';
import { publishedList, safely, trendingList } from '@/lib/newsServer';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, absoluteUrl, siteOrigin } from '@/lib/socialCard';
import { NewsFollow, NewsHero, NewsTopics } from '@/components/news/NewsChrome';
import { SiteFooter, SiteNavbar } from '@/components/SiteChrome';
import { LoadMore, StoryCard } from '@/components/news/NewsClient';

// /news - the church's news, newest first. The top is laid out like a news
// front page: the featured story large in the middle, a picture story and
// headlines on the left, the most read on the right. Below it, every other
// story as a grid. ?category= narrows it to one topic.

export const revalidate = 60;

const FIRST_PAGE = 40;

export async function generateMetadata({ searchParams }) {
  const brand = brandFor(await readBranding());
  const category = NEWS_CATEGORIES.includes(searchParams?.category) ? searchParams.category : null;
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

function Headline({ article }) {
  return (
    <Link href={articlePath(article.slug)} className="nw-headline">
      <span className="nw-kicker">{article.category}</span>
      <strong>{article.title}</strong>
      <span className="nw-card-date">{timeAgo(article.published_at)}</span>
    </Link>
  );
}

function Thumb({ article, rank }) {
  return (
    <Link href={articlePath(article.slug)} className="nw-thumb">
      <span className="nw-thumb-img">
        {article.featured_image_url
          ? <img src={newsImage(article.featured_image_url, 240)} alt="" loading="lazy" decoding="async" />
          : <span className="nw-noimg" aria-hidden="true"></span>}
        {rank && <span className="nw-rank">{rank}</span>}
      </span>
      <span>
        <strong>{article.title}</strong>
        <span className="nw-card-date">{newsDate(article.published_at)}</span>
      </span>
    </Link>
  );
}

export default async function NewsPage({ searchParams }) {
  const category = NEWS_CATEGORIES.includes(searchParams?.category) ? searchParams.category : null;
  const [{ articles, total }, trending] = await Promise.all([
    safely(() => publishedList({ limit: FIRST_PAGE, category }), { articles: [], total: 0 }),
    category ? Promise.resolve([]) : safely(() => trendingList({ limit: 5 }), []),
  ]);

  // The story at the top: the one marked Featured, or simply the newest.
  const lead = category ? null : (articles.find((a) => a.is_featured) || articles[0] || null);
  const rest = articles.filter((a) => a !== lead);
  const leftCard = rest[0];
  const headlines = rest.slice(1, 5);
  const moreRow = rest.slice(5, 8);
  const grid = category ? articles : rest.slice(8);

  return (
    <div className="nw-page">
      <SiteNavbar current="news" />
      <NewsHero category={category} />
      <NewsTopics category={category} />

      <main className="nw-wrap nw-main">
        {articles.length === 0 ? (
          <section className="nw-empty">
            <span className="nw-eyebrow">News</span>
            <h1>{category ? `No ${category} stories yet` : 'No news yet'}</h1>
            <p>{category ? 'Try another topic, or see all the news.' : 'Stories from the church will appear here soon.'}</p>
            {category && <Link href="/news" className="nw-btn">See all news</Link>}
          </section>
        ) : (
          <>
            {lead && (
              <section className={`nw-front ${rest.length < 2 ? 'solo' : ''}`} aria-label="Top stories">
                {rest.length >= 2 && (
                  <aside className="nw-front-left">
                    {leftCard && <StoryCard article={leftCard} size="sm" />}
                    {headlines.map((a) => <Headline key={a.id} article={a} />)}
                  </aside>
                )}

                <div className="nw-front-lead">
                  <Link href={articlePath(lead.slug)} className="nw-lead">
                    <span className="nw-lead-img">
                      {lead.featured_image_url
                        ? <img src={newsImage(lead.featured_image_url, 1200)} srcSet={[760, 1200].map((w) => `${newsImage(lead.featured_image_url, w)} ${w}w`).join(', ')} sizes="(max-width: 980px) 100vw, 900px" alt="" />
                        : <span className="nw-noimg" aria-hidden="true">{lead.category}</span>}
                      <span className="nw-pill">{lead.is_featured ? 'Featured' : 'Latest'}</span>
                    </span>
                    <span className="nw-kicker">{lead.category} · {newsDate(lead.published_at)}</span>
                    <h1>{lead.title}</h1>
                    {lead.summary && <p>{lead.summary}</p>}
                  </Link>
                  {moreRow.length > 0 && (
                    <div className="nw-morerow">
                      {moreRow.map((a) => <StoryCard key={a.id} article={a} size="sm" />)}
                    </div>
                  )}
                </div>

                {trending.length > 0 && rest.length >= 2 && (
                  <aside className="nw-front-right">
                    <h2 className="nw-side-title">Most read</h2>
                    {trending.map((a, i) => <Thumb key={a.id} article={a} rank={i + 1} />)}
                  </aside>
                )}
              </section>
            )}

            {grid.length > 0 && (
              <section className="nw-latest" aria-label="Latest stories">
                <div className="nw-section-head">
                  <h2>{category || 'Latest stories'}</h2>
                  {category && <Link href="/news">All news</Link>}
                </div>
                <div className="nw-grid">
                  {grid.map((a) => <StoryCard key={a.id} article={a} />)}
                </div>
              </section>
            )}
            <LoadMore offset={articles.length} total={total} category={category} />
          </>
        )}

        <NewsFollow />
      </main>

      <SiteFooter />
    </div>
  );
}
