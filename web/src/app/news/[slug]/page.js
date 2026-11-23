import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../home.css';
import '../news.css';
import { newsFonts } from '../fonts';
import { articlePath, newsDate, newsImage, readingMinutes, safeHref, timeAgo } from '@/lib/news';
import { publishedArticle, publishedList, safely } from '@/lib/newsServer';
import { supabaseAdmin } from '@/lib/supabase';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, absoluteUrl, siteOrigin, socialCardImage } from '@/lib/socialCard';
import { evtDate } from '@/lib/eventWhen';
import { SiteFooter, SiteNavbar } from '@/components/SiteChrome';
import { ReadingProgress, StoryCard, ViewPing } from '@/components/news/NewsClient';
import Story from '@/components/news/Story';

// /news/<slug> - one article, laid out to be read (see components/news/Story
// for the article itself, in English, Tagalog or Bisaya).
//
// Drawn on the server, so a link shared on Facebook, Messenger or Viber shows
// the article's picture, headline and summary: the picture is reshaped to the
// 1200x630 card those apps expect, without cropping a poster's words off
// (lib/socialCard). Cached for a minute and refreshed at once when the
// article is saved.

export const revalidate = 60;

export async function generateMetadata({ params }) {
  const [article, branding] = await Promise.all([
    safely(() => publishedArticle(params.slug), null),
    readBranding(),
  ]);
  const brand = brandFor(branding);
  if (!article) return { title: `News · ${brand.name}` };

  const origin = siteOrigin();
  const url = `${origin}${articlePath(article.slug)}`;
  const card = article.featured_image_url ? socialCardImage(article.featured_image_url, origin) : '';
  const image = card || absoluteUrl(DEFAULT_CARD_IMAGE, origin);
  // Only promise 1200x630 when the image really is that shape: a Cloudinary
  // upload reshaped by socialCardImage, or the default card.
  const sized = !card || card !== absoluteUrl(article.featured_image_url, origin);
  const description = article.summary || `News from ${brand.church}.`;

  return {
    title: `${article.title} · ${brand.name}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      siteName: brand.name,
      url,
      title: article.title,
      description,
      locale: 'en_PH',
      publishedTime: article.published_at || undefined,
      modifiedTime: article.updated_at || undefined,
      section: article.category,
      tags: article.tags || undefined,
      images: [{ url: image, ...(sized ? { width: OG_WIDTH, height: OG_HEIGHT, type: 'image/jpeg' } : {}), alt: article.title }],
    },
    twitter: { card: 'summary_large_image', title: article.title, description, images: [image] },
  };
}

const initials = (name) => String(name || 'News Desk').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// "Oct 2 – 3, 2026" for an event card.
const eventWhen = (start, end) => {
  const s = evtDate(start);
  if (!s) return '';
  const e = evtDate(end);
  const opt = { month: 'long', day: 'numeric', year: 'numeric' };
  if (!e || s.toDateString() === e.toDateString()) return s.toLocaleDateString('en-US', opt);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', opt)}`;
};

// The events the article links to, as they stand now.
async function linkedEvents(blocks) {
  const ids = [...new Set((blocks || []).filter((b) => b.type === 'event' && b.eventId).map((b) => b.eventId))];
  if (!ids.length) return {};
  const { data } = await supabaseAdmin
    .from('events')
    .select('id, title, event_date, end_date, location, loc_city, loc_province, image_url, is_published, is_active')
    .in('id', ids);
  const map = {};
  (data || []).forEach((e) => {
    if (e.is_active === false) return;
    map[e.id] = {
      title: e.title,
      when: eventWhen(e.event_date, e.end_date),
      place: [e.location, e.loc_city || e.loc_province].filter(Boolean).join(', '),
      image: e.image_url || null,
    };
  });
  return map;
}

export default async function ArticlePage({ params }) {
  const article = await safely(() => publishedArticle(params.slug), null);
  if (!article) notFound();

  const [{ articles: latestAll }, { articles: sameTopic }, events] = await Promise.all([
    safely(() => publishedList({ limit: 6 }), { articles: [] }),
    safely(() => publishedList({ limit: 4, category: article.category }), { articles: [] }),
    safely(() => linkedEvents(article.content), {}),
  ]);
  // More of the same topic first, then the newest, three in all.
  const more = [...sameTopic, ...latestAll]
    .filter((a, i, list) => a.id !== article.id && list.findIndex((b) => b.id === a.id) === i)
    .slice(0, 3);

  const edited = article.updated_at && article.published_at
    && new Date(article.updated_at).getTime() - new Date(article.published_at).getTime() > 10 * 60000;
  const author = article.author_name || 'Church News Desk';
  const views = article.views || 0;
  const coverUrl = article.featured_image_url;

  return (
    <div className={`nw-page nw-story ${newsFonts}`}>
      <SiteNavbar current="news" />
      <ReadingProgress />
      <ViewPing id={article.id} />

      <Story
        article={{
          id: article.id,
          title: article.title,
          summary: article.summary,
          content: article.content || [],
          translations: article.translations || {},
          category: article.category,
          tags: article.tags || [],
          author,
          source: safeHref(article.source_url || '') || null,
        }}
        events={events}
        path={articlePath(article.slug)}
        minutes={readingMinutes(article.content_text)}
        cover={coverUrl ? {
          blur: newsImage(coverUrl, 480),
          src: newsImage(coverUrl, 1200),
          srcSet: [760, 1200, 1600].map((w) => `${newsImage(coverUrl, w)} ${w}w`).join(', '),
        } : null}
        labels={{
          initials: initials(author),
          // Worked out here, once, so the page and the browser agree on them.
          dateLine: `${newsDate(article.published_at, { month: 'long' })}${edited ? ` · Updated ${timeAgo(article.updated_at)}` : ''} · ${views.toLocaleString()} ${views === 1 ? 'view' : 'views'}`,
          published: newsDate(article.published_at, { month: 'long' }),
          updated: edited ? `Updated ${newsDate(article.updated_at, { month: 'long' })}` : '',
        }}
      />

      {/* ---- More stories ---- */}
      {more.length > 0 && (
        <section className="nw-keep" aria-label="Keep reading">
          <div className="nw-wrap">
            <div className="nw-section-head">
              <h2>Keep reading</h2>
              <Link href="/news">All news</Link>
            </div>
            <div className="nw-grid">
              {more.map((a) => <StoryCard key={a.id} article={a} />)}
            </div>
          </div>
        </section>
      )}

      {/* ---- An invitation, as the landing page ends ---- */}
      <section className="nw-invite">
        <div className="nw-wrap nw-invite-inner">
          <div>
            <span className="nw-eyebrow">Visit us</span>
            <h2>Worship with us this Sunday</h2>
            <p>Sunday Worship at 9:00 AM in Cebu City. Come as you are; everyone is welcome.</p>
          </div>
          <div className="nw-invite-actions">
            <Link href="/#plan-visit" className="nw-btn">Plan your visit</Link>
            <Link href="/live" className="nw-btn-ghost">Watch live</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
