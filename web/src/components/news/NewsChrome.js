'use client';

// The News pages' own pieces, around the landing page's navbar and footer
// (components/SiteChrome): the photo banner at the top of /news, drawn like
// the landing page's hero (a church photo under a dark fade, the gold lockup
// over it), and the "Stay connected" box.

import Link from 'next/link';
import { useBranding } from '@/components/BrandingProvider';

const FACEBOOK_URL = 'https://www.facebook.com/CebuCityJoyfulSound';
const YOUTUBE_URL = 'https://www.youtube.com/@JoyfulSoundChurchCebuCity';

// The banner photo: a Sunday service, no words printed on it, so the
// heading over it reads cleanly.
const HERO_PHOTO = '/assets/worship-service.jpg';

export function NewsHero({ count = 0 }) {
  const brand = useBranding();
  return (
    <section className="nw-hero">
      <img src={HERO_PHOTO} alt="" className="nw-hero-img" fetchPriority="high" />
      <div className="nw-hero-overlay">
        <p className="nw-hero-eyebrow">{brand.isPlatform ? `${brand.name} · ${brand.church}` : brand.full}</p>
        <h1 className="nw-hero-title">News &amp; Stories</h1>
        <p className="nw-hero-sub">What God is doing in our church family: stories, events and announcements</p>
        {count > 0 && (
          <a href="#all-news" className="nw-hero-cta">
            Browse all {count === 1 ? 'the' : count.toLocaleString()} {count === 1 ? 'story' : 'stories'} <i className="fas fa-arrow-down" aria-hidden="true"></i>
          </a>
        )}
      </div>
    </section>
  );
}

// Follow the church: in place of the newsletter box a news site would have.
export function NewsFollow() {
  const brand = useBranding();
  return (
    <section className="nw-follow">
      <div className="nw-follow-copy">
        <span className="nw-eyebrow">Stay connected</span>
        <h2>Never miss what God is doing at {brand.church}.</h2>
        <p>Follow the church for news, service highlights and announcements, or come and worship with us this Sunday.</p>
      </div>
      <div className="nw-follow-card">
        <h3>Follow us</h3>
        <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="nw-follow-link fb"><i className="fab fa-facebook-f"></i> Facebook</a>
        <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer" className="nw-follow-link yt"><i className="fab fa-youtube"></i> YouTube</a>
        <Link href="/#plan-visit" className="nw-follow-visit">Plan your visit</Link>
      </div>
    </section>
  );
}
