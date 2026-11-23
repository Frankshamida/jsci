'use client';

// The landing page's navbar and footer, for the pages that live beside it
// (News). Same markup and the same classes as src/app/page.js, styled by the
// landing page's own stylesheet (home.css, imported by those pages), so the
// black-glass bar, the gold brand lockup, the gold Log In button and the dark
// mode switch look and behave exactly as they do on the home page. Section
// links point back to the home page (/#plan-visit), which scrolls to them.

import { useEffect, useState } from 'react';
import { useBranding } from '@/components/BrandingProvider';

const FACEBOOK_URL = 'https://www.facebook.com/CebuCityJoyfulSound';
const MESSENGER_URL = 'https://m.me/CebuCityJoyfulSound';
const YOUTUBE_URL = 'https://www.youtube.com/@JoyfulSoundChurchCebuCity';
const DIRECTIONS_URL = 'https://www.google.com/maps/dir/?api=1&destination=10.31957253395332,123.8994709106599';

// The landing page's links, in its order. `page` marks the one you are on.
const LINKS = [
  { href: '/#about', label: 'About' },
  { href: '/#plan-visit', label: 'Plan a Visit' },
  { href: '/#ministries', label: 'Ministries' },
  { href: '/#this-week', label: 'Events' },
  { href: '/#isom', label: 'ISOM' },
  { href: '/news', label: 'News', page: 'news' },
  { href: '/#give', label: 'Give' },
  { href: '/#location', label: 'Location' },
];

export function SiteNavbar({ current = null }) {
  const brand = useBranding();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    setDark(document.body.classList.contains('dark-mode'));
  }, []);

  // "Live" appears in the bar while a service is streaming, as on the home page.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/live-streams/public');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setLive(Array.isArray(json) && json.length > 0);
      } catch { /* nothing live */ }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem('darkModeEnabled', next); } catch { /* not saved */ }
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  return (
    <nav className={`hp-navbar ${brand.isPlatform ? 'is-platform' : ''}`} aria-label="Main">
      <a className="hp-navbar-brand" href="/">
        <img src="/assets/LOGO.png" alt={`${brand.full} logo`} className="hp-navbar-logo" decoding="async" />
        <div className="hp-navbar-title">
          {brand.name}
          <span>{brand.navSub}</span>
        </div>
      </a>

      <div className={`hp-navbar-links ${open ? 'open' : ''}`}>
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className={l.page && l.page === current ? 'is-current' : undefined}
            aria-current={l.page && l.page === current ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {l.label}
          </a>
        ))}
        {live && (
          <a href="/live" className="hp-btn-live"><span className="hp-live-dot" aria-hidden="true"></span> Live</a>
        )}
        <a href="/login" className="hp-btn-login">Log In</a>
      </div>

      <div className="hp-navbar-actions">
        <button className="dark-mode-toggle" onClick={toggleDark} title="Toggle Dark Mode" aria-label="Toggle dark mode">
          <i className={`fas ${dark ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
        <button className="hp-nav-toggle" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          <i className={`fas ${open ? 'fa-times' : 'fa-bars'}`}></i>
        </button>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  const brand = useBranding();
  return (
    <footer className="hp-footer">
      <div className="hp-footer-grid">
        <div className="hp-footer-about">
          <div className="hp-footer-brand">
            <img src="/assets/LOGO.png" alt={`${brand.full} logo`} loading="lazy" decoding="async" />
            <h3>
              {brand.name}
              <span>{brand.isPlatform ? brand.church : brand.sub}</span>
            </h3>
          </div>
          <p>
            A Spirit-filled community of believers dedicated to spreading the gospel,
            building disciples, and making a lasting impact for God&apos;s kingdom.
          </p>
          <div className="hp-footer-socials">
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" title="Facebook" aria-label="Facebook"><i className="fab fa-facebook-f"></i></a>
            <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer" title="YouTube" aria-label="YouTube"><i className="fab fa-youtube"></i></a>
            <a href={MESSENGER_URL} target="_blank" rel="noopener noreferrer" title="Messenger" aria-label="Messenger"><i className="fab fa-facebook-messenger"></i></a>
          </div>
        </div>

        <div className="hp-footer-col">
          <h4>Explore</h4>
          <ul>
            <li><a href="/#about">About Us</a></li>
            <li><a href="/#plan-visit">Plan a Visit</a></li>
            <li><a href="/#ministries">Ministries</a></li>
            <li><a href="/#this-week">Events</a></li>
            <li><a href="/#isom">ISOM</a></li>
            <li><a href="/#give">Give</a></li>
            <li><a href="/news">News</a></li>
          </ul>
        </div>

        <div className="hp-footer-col">
          <h4>Online</h4>
          <ul>
            <li><a href="/live">Watch Live</a></li>
            <li><a href="/ministrymobileapp">Ministry App</a></li>
            <li><a href="/">Ask Joy</a></li>
            <li><a href="/login">Member Login</a></li>
            <li><a href="/signup">Create an Account</a></li>
          </ul>
        </div>

        <div className="hp-footer-col">
          <h4>Get in Touch</h4>
          <ul>
            <li><a href="/#location">Cebu City, Philippines</a></li>
            <li><a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer">Get Directions</a></li>
            <li><a href={MESSENGER_URL} target="_blank" rel="noopener noreferrer">Message Us</a></li>
            <li><a href="/terms">Terms</a></li>
            <li><a href="/privacy-policy">Privacy Policy</a></li>
          </ul>
        </div>
      </div>

      <div className="hp-footer-bottom">
        <p>
          &copy; {new Date().getFullYear()} <span>{brand.owner}</span>. All rights reserved.
          {brand.isPlatform
            ? <> Serving {brand.church}.</>
            : <> Powered by <span>{brand.platform}</span>.</>}
        </p>
      </div>
    </footer>
  );
}
