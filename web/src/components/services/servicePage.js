// The service pages, server side: /sunday-service and /midweek (and each
// service's own page under them) share one frame and one way of describing
// themselves to search engines and shared links.
//
// A service is handed to the page (components/services/ServiceClient) in one
// shape, whichever kind it is:
//   { id, slug, title, speaker, description, date, template, label, category, live }

import '@/app/home.css';
import './services.css';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, absoluteUrl, siteOrigin } from '@/lib/socialCard';
import { categoryLabel, midweekPath, serviceDate } from '@/lib/serviceVideos';
import { SUNDAY_LABEL, sundayPath } from '@/lib/sundayService';
import { SiteFooter, SiteNavbar } from '@/components/SiteChrome';

export const SERVICE_KINDS = {
  sunday: { name: SUNDAY_LABEL, path: sundayPath },
  midweek: { name: 'Midweek Service', path: midweekPath },
};

// A Midweek Service video, as the page shows it.
export const midweekItem = (v) => ({
  id: v.id,
  slug: v.slug,
  title: v.title,
  speaker: v.speaker || null,
  description: v.description || null,
  date: v.service_date,
  template: v.thumbnail_template,
  label: categoryLabel(v.category),
  category: v.category,
  live: false,
});

// A Sunday Service (a Facebook Live), as the page shows it.
export const sundayItem = (s) => ({
  id: s.id,
  slug: s.slug,
  title: s.title,
  speaker: s.speaker || null,
  description: s.description || null,
  date: s.service_date,
  template: s.thumbnail_template,
  label: SUNDAY_LABEL,
  category: 'sunday',
  live: !!s.is_live,
});

export function ServiceShell({ path, children }) {
  return (
    <div className="wt-page">
      <SiteNavbar loginHref={`/login?next=${encodeURIComponent(path)}`} />
      {children}
      <SiteFooter />
    </div>
  );
}

// <title>, the description, and the card a shared link shows.
export async function serviceMetadata(kind, item) {
  const { name, path: pathOf } = SERVICE_KINDS[kind];
  const brand = brandFor(await readBranding());
  const origin = siteOrigin();
  const path = pathOf(item?.slug);
  const date = serviceDate(item?.date);
  const label = item?.label || name;
  const title = item ? `${item.title} · ${label} · ${brand.name}` : `${name} · Watch · ${brand.name}`;
  const ogTitle = item ? item.title : `${name} · ${brand.name}`;
  const description = item
    ? [
      `${label}${date ? `, ${date.long}` : ''}${item.speaker ? ` · ${item.speaker}` : ''}.`,
      item.description ? item.description.split('\n')[0].slice(0, 160) : `Watch it online with ${brand.church}. A free account is all you need.`,
    ].join(' ')
    : kind === 'sunday'
      ? `Watch the Sunday Service of ${brand.church} live online, or one you missed. A free account is all you need.`
      : `Watch the Online Midweek Service and other services of ${brand.church}. A free account is all you need.`;
  const image = absoluteUrl(DEFAULT_CARD_IMAGE, origin);
  return {
    title,
    description,
    alternates: { canonical: `${origin}${path}` },
    openGraph: {
      type: 'website',
      siteName: brand.name,
      url: `${origin}${path}`,
      title: ogTitle,
      description,
      images: [{ url: image, width: OG_WIDTH, height: OG_HEIGHT, type: 'image/jpeg', alt: ogTitle }],
    },
    twitter: { card: 'summary_large_image', title: ogTitle, description, images: [image] },
  };
}

// /<kind>/<a slug no service has> - said kindly, with the way back.
export function ServiceNotFound({ kind }) {
  const { name, path } = SERVICE_KINDS[kind];
  return (
    <ServiceShell path={path()}>
      <main className="wt-main">
        <section className="wt-head">
          <div className="wt-wrap">
            <span className="wt-eyebrow">Watch online</span>
            <h1>{name}</h1>
          </div>
        </section>
        <div className="wt-wrap">
          <section className="wt-empty">
            <h2>Service not found</h2>
            <p>We could not find that service. It may have been renamed or taken down, or the link may be incomplete.</p>
            <div className="wt-empty-btns">
              <a href={path()} className="wt-btn">Watch the latest {name}</a>
              <a href="/" className="wt-btn is-soft">Back to home</a>
            </div>
          </section>
        </div>
      </main>
    </ServiceShell>
  );
}
