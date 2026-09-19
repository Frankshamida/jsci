// The public face of an event "magic link": /miracle-working-god-cebu-event.
//
// This used to be a rewrite in next.config.mjs that pointed every single-segment
// path at the home page. That worked for a person - the page reads the slug back
// off the address bar and opens the right registration - but not for a crawler.
// Facebook, Messenger, WhatsApp and the rest never run the page's JavaScript;
// they read the HTML that comes back and nothing else. All they ever saw was the
// home page's own <title> and no image, so every event anybody shared came back
// as the church logo and the words "Joyful Sound Church International".
//
// A real route can answer them, because `generateMetadata` runs on the server:
// the slug is resolved against the published events here, and the event's own
// poster and name go into the page's Open Graph tags before it is sent. What a
// person gets is unchanged - the same home page, which still reads the slug and
// opens the same registration.
//
// The dashboard sections (/events, /messages, ...) are rewritten in
// next.config.mjs under `afterFiles`, which Next checks BEFORE dynamic routes -
// so they keep winning over this file and nothing here shadows them.

import { headers } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { cached } from '@/lib/serverCache';
import { findEventBySlug, slugFromPath } from '@/lib/eventSlug';
import {
  absoluteUrl, DEFAULT_CARD_IMAGE, eventCardMetadata, OG_HEIGHT, OG_WIDTH,
  siteOrigin, SITE_NAME, SITE_TAGLINE,
} from '@/lib/socialCard';
import HomePage from '../page';

// The domain this particular request came in on, which is the one that has to
// appear on the card: og:url is what Facebook treats as the link's canonical
// address and re-scrapes, so a card built on the wrong host sends everybody who
// taps it to the wrong host. Reading it off the request means the card is right
// on the live domain, on a preview deploy and on localhost alike, without
// anything to keep in step. NEXT_PUBLIC_SITE_URL remains the fallback.
const requestOrigin = () => {
  try {
    const h = headers();
    // Behind a proxy these are lists ("a.com, b.com"); the first is the client's.
    const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim();
    if (host) {
      const proto = (h.get('x-forwarded-proto') || '').split(',')[0].trim()
        || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  } catch { /* not in a request scope - fall through to the configured origin */ }
  return siteOrigin();
};

// Only what a card needs. The registration data the page itself runs on is
// fetched in the browser as before.
const CARD_FIELDS = 'id, title, description, event_date, end_date, location, loc_city, loc_province, loc_region, image_url';

// Reading the request headers above opts this route out of static rendering, so
// the list is cached here instead. A link doing the rounds of a group chat then
// costs one query rather than one per tap, and an edited event still shows its
// new name and poster in shares made a few minutes later. (Facebook caches its
// own scrape for far longer - the Sharing Debugger's "Scrape Again" clears that.)
const CARD_TTL_MS = 300_000;

async function eventForSlug(slug) {
  if (!slug || !supabase) return null;
  try {
    const events = await cached('social:event-cards', CARD_TTL_MS, async () => {
      const { data, error } = await supabase
        .from('events')
        .select(CARD_FIELDS)
        .eq('is_active', true)
        .eq('is_published', true)
        .order('event_date', { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    });
    // Same resolution the page uses, so the card and the registration that
    // opens under it can never be for two different events.
    return findEventBySlug(events, slug);
  } catch {
    // A link must still open when the database is unreachable - it just opens
    // with the site's own card on it.
    return null;
  }
}

export async function generateMetadata({ params }) {
  const origin = requestOrigin();
  const slug = slugFromPath(params?.eventSlug || '');
  const url = slug ? `${origin}/${slug}` : origin;
  const evt = await eventForSlug(slug);

  if (!evt) {
    // A slug that matches nothing - a typo, or an event since unpublished.
    // The page still opens (it says so itself), and the card is the site's.
    //
    // Spelled out rather than left to the root layout: Next replaces a parent's
    // `openGraph` wholesale when a page defines one, so the image has to be
    // named here too or this page would go out with no picture at all.
    const image = absoluteUrl(DEFAULT_CARD_IMAGE, origin);
    return {
      title: SITE_NAME,
      description: SITE_TAGLINE,
      alternates: { canonical: url },
      openGraph: {
        type: 'website',
        siteName: SITE_NAME,
        url,
        title: SITE_NAME,
        description: SITE_TAGLINE,
        images: [{ url: image, width: OG_WIDTH, height: OG_HEIGHT, alt: SITE_NAME, type: 'image/jpeg' }],
      },
      twitter: { card: 'summary_large_image', title: SITE_NAME, description: SITE_TAGLINE, images: [image] },
    };
  }

  return eventCardMetadata(evt, url, origin);
}

export default function EventLinkPage() {
  return <HomePage />;
}
