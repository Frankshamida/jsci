// The giving pages, server side: /donation, a drive's page, the receipt and
// My giving share one frame - the landing page's navbar and footer around the
// dark band - and one way of describing themselves to shared links.

import '@/app/home.css';
import './giving.css';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { DEFAULT_CARD_IMAGE, OG_HEIGHT, OG_WIDTH, absoluteUrl, siteOrigin } from '@/lib/socialCard';
import { SiteFooter, SiteNavbar } from '@/components/SiteChrome';

export function GivingShell({ path = '/donation', children }) {
  return (
    <div className="gv-page">
      <SiteNavbar current="giving" loginHref={`/login?next=${encodeURIComponent(path)}`} />
      {children}
      <SiteFooter />
    </div>
  );
}

export async function givingMetadata({ title, description, path, image = null, noindex = false }) {
  const brand = brandFor(await readBranding());
  const origin = siteOrigin();
  const url = `${origin}${path}`;
  const card = image || absoluteUrl(DEFAULT_CARD_IMAGE, origin);
  return {
    title: `${title} · ${brand.name}`,
    description,
    alternates: { canonical: url },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: 'website',
      siteName: brand.name,
      url,
      title,
      description,
      locale: 'en_PH',
      images: [{ url: card, ...(image ? {} : { width: OG_WIDTH, height: OG_HEIGHT }), alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [card] },
  };
}
