import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../home.css';
import '../news.css';
import { NEWS_CATEGORIES, articlePath, newsDate, newsImage, readingMinutes, safeHref, timeAgo } from '@/lib/news';
import { categoryCounts, publishedArticle, publishedList, safely } from '@/lib/newsServer';
import { supabaseAdmin } from '@/lib/supabase';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, absoluteUrl, newsCardImage, siteOrigin } from '@/lib/socialCard';
import { evtDate } from '@/lib/eventWhen';
import { SiteFooter, SiteNavbar } from '@/components/SiteChrome';
import { MoreNews, ReadingProgress, ViewPing } from '@/components/news/NewsClient';
import Story from '@/components/news/Story';
import GivingCard from '@/components/giving/GivingCard';
import { featuredCampaigns } from '@/lib/givingServer';

// /news/<slug> - one article, laid out to be read (see components/news/Story
// for the article itself, in English, Tagalog or Bisaya).
//
// Drawn on the server, so a link shared on Facebook, Messenger or Viber shows
// the article's picture, headline and summary: the picture fills the whole
// 1200x630 card those apps expect, cropped around its subject
// (lib/socialCard newsCardImage). Cached for a minute and refreshed at once
// when the article is saved.

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
  const card = article.featured_image_url ? newsCardImage(article.featured_image_url, origin) : '';
  const image = card || absoluteUrl(DEFAULT_CARD_IMAGE, origin);
  // Only promise 1200x630 when the image really is that shape: a Cloudinary
  // upload filled to the card by newsCardImage, or the default card.
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

// "For you": stories like this one first - the same topic, then shared tags -
// and the newest to fill the row. Six at most.
function suggestionsFor(article, pool) {
  const tags = new Set((article.tags || []).map((t) => String(t).toLowerCase()));
  const seen = new Set([article.id]);
  return pool
    .filter((a) => (seen.has(a.id) ? false : seen.add(a.id)))
    .map((a) => ({
      a,
      score: (a.category === article.category ? 3 : 0)
        + (a.tags || []).filter((t) => tags.has(String(t).toLowerCase())).length,
      at: new Date(a.published_at || 0).getTime(),
    }))
    .sort((x, y) => y.score - x.score || y.at - x.at)
    .slice(0, 6)
    .map((x) => x.a);
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

  const [{ articles: latestAll }, { articles: sameTopic }, counts, events, appeals] = await Promise.all([
    safely(() => publishedList({ limit: 13 }), { articles: [] }),
    safely(() => publishedList({ limit: 8, category: article.category }), { articles: [] }),
    safely(() => categoryCounts(), {}),
    safely(() => linkedEvents(article.content), {}),
    // A featured giving appeal, shown beside the story like a quiet advertisement.
    safely(() => featuredCampaigns(), []),
  ]);
  const appeal = appeals[0] || null;
  const others = (list) => list.filter((a) => a.id !== article.id);
  const suggested = suggestionsFor(article, [...sameTopic, ...latestAll]);
  const latest = others(latestAll).slice(0, 6);
  // Stories in each topic apart from this one.
  const otherCounts = { ...counts };
  if (otherCounts[article.category]) otherCounts[article.category] -= 1;

  const edited = article.updated_at && article.published_at
    && new Date(article.updated_at).getTime() - new Date(article.published_at).getTime() > 10 * 60000;
  const author = article.author_name || 'Church News Desk';
  const views = article.views || 0;
  const coverUrl = article.featured_image_url;

  return (
    <div className="nw-page nw-story">
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
        aside={appeal ? <GivingCard campaign={appeal} variant="rail" /> : null}
        asideInline={appeal ? <GivingCard campaign={appeal} variant="inline" /> : null}
        labels={{
          initials: initials(author),
          // Worked out here, once, so the page and the browser agree on them.
          dateLine: `${newsDate(article.published_at, { month: 'long' })}${edited ? ` · Updated ${timeAgo(article.updated_at)}` : ''} · ${views.toLocaleString()} ${views === 1 ? 'view' : 'views'}`,
        }}
      />

      {/* ---- More news: suggestions, the latest, or any topic ---- */}
      <MoreNews
        currentId={article.id}
        suggested={suggested}
        latest={latest}
        counts={otherCounts}
        categories={NEWS_CATEGORIES}
      />

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
            <Link href="/sunday-service" className="nw-btn-ghost">Watch live</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
