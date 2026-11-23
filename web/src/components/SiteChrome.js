'use client';

// The site's navbar and footer - one component, used by the home page and the
// pages beside it (News), styled by the landing page's stylesheet (home.css):
// the black-glass bar, the gold brand lockup, the gold Log In button and the
// dark mode switch.
//
// The links are grouped so the bar holds five things instead of eight:
//   About ▾ (Who We Are, Our Pastors, Location)   Plan a Visit
//   Get Involved ▾ (Ministries, Events, ISOM, Watch Live)   News   Give
// On a computer a group opens on hover or click; on a phone the menu lists
// every group under its name. Section links point at the home page
// (/#plan-visit); ON the home page, `onSection` scrolls there smoothly instead.

import { useEffect, useRef, useState } from 'react';
import { useBranding } from '@/components/BrandingProvider';

const FACEBOOK_URL = 'https://www.facebook.com/CebuCityJoyfulSound';
const MESSENGER_URL = 'https://m.me/CebuCityJoyfulSound';
const YOUTUBE_URL = 'https://www.youtube.com/@JoyfulSoundChurchCebuCity';
const DIRECTIONS_URL = 'https://www.google.com/maps/dir/?api=1&destination=10.31957253395332,123.8994709106599';

// `section` is the id on the home page; `page` marks the page you are on.
const NAV = [
  {
    label: 'About',
    items: [
      { href: '/#about', section: 'about', label: 'Who We Are', hint: 'Our story and what we believe' },
      { href: '/#pastors', section: 'pastors', label: 'Our Pastors', hint: 'The leaders shepherding our church' },
      { href: '/#location', section: 'location', label: 'Location', hint: 'Find us in Cebu City' },
    ],
  },
  { href: '/#plan-visit', section: 'plan-visit', label: 'Plan a Visit' },
  {
    label: 'Get Involved',
    items: [
      { href: '/#ministries', section: 'ministries', label: 'Ministries', hint: 'Find your place to serve' },
      { href: '/#news', section: 'news', label: 'Events', hint: 'What is coming up' },
      { href: '/#isom', section: 'isom', label: 'ISOM', hint: 'International School of Ministries' },
      { href: '/live', label: 'Watch Live', hint: 'Join a service online' },
    ],
  },
  { href: '/news', label: 'News', page: 'news' },
  { href: '/#give', section: 'give', label: 'Give' },
];

export function SiteNavbar({ current = null, onSection = null, live: liveProp }) {
  const brand = useBranding();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(null); // the dropdown that is open
  const [dark, setDark] = useState(false);
  const [liveFetched, setLiveFetched] = useState(false);
  const live = liveProp ?? liveFetched;
  const navRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => {
    setDark(document.body.classList.contains('dark-mode'));
  }, []);

  // "Live" appears in the bar while a service is streaming. The home page
  // already knows and says so through `live`; other pages ask.
  useEffect(() => {
    if (liveProp !== undefined) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/live-streams/public');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setLiveFetched(Array.isArray(json) && json.length > 0);
      } catch { /* nothing live */ }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [liveProp]);

  // A click anywhere else, or Escape, closes an open dropdown.
  useEffect(() => {
    if (!group) return undefined;
    const onDown = (e) => { if (!navRef.current?.contains(e.target)) setGroup(null); };
    const onKey = (e) => { if (e.key === 'Escape') setGroup(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [group]);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem('darkModeEnabled', next); } catch { /* not saved */ }
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const go = (e, item) => {
    setOpen(false);
    setGroup(null);
    if (onSection && item.section) {
      e.preventDefault();
      onSection(item.section);
    }
  };

  // Hover opens a group on a computer; a short delay on leaving lets the
  // pointer cross the gap into the dropdown.
  const enter = (label) => { clearTimeout(closeTimer.current); setGroup(label); };
  const leave = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setGroup(null), 180); };
  const isCurrent = (item) => item.page && item.page === current;

  return (
    <nav ref={navRef} className={`hp-navbar ${brand.isPlatform ? 'is-platform' : ''}`} aria-label="Main">
      <a className="hp-navbar-brand" href="/">
        <img
          src="/assets/LOGO.png"
          alt={`${brand.full} logo`}
          className="hp-navbar-logo"
          fetchPriority={current === 'home' ? 'high' : undefined}
          decoding="async"
        />
        <div className="hp-navbar-title">
          {brand.name}
          <span>{brand.navSub}</span>
        </div>
      </a>

      <div className={`hp-navbar-links ${open ? 'open' : ''}`}>
        {NAV.map((n) => (n.items ? (
          <div
            key={n.label}
            className={`hp-nav-group ${group === n.label ? 'open' : ''}`}
            onMouseEnter={() => enter(n.label)}
            onMouseLeave={leave}
          >
            <button
              type="button"
              className="hp-nav-group-btn"
              aria-expanded={group === n.label}
              aria-haspopup="true"
              onClick={() => setGroup((g) => (g === n.label ? null : n.label))}
            >
              {n.label}
              <i className="fas fa-chevron-down" aria-hidden="true"></i>
            </button>
            <div className="hp-nav-drop" role="menu">
              <span className="hp-nav-drop-title">{n.label}</span>
              {n.items.map((item) => (
                <a key={item.href} href={item.href} role="menuitem" onClick={(e) => go(e, item)}>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </a>
              ))}
            </div>
          </div>
        ) : (
          <a
            key={n.href}
            href={n.href}
            className={isCurrent(n) ? 'is-current' : undefined}
            aria-current={isCurrent(n) ? 'page' : undefined}
            onClick={(e) => go(e, n)}
          >
            {n.label}
          </a>
        )))}
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
            <li><a href="/#news">Events</a></li>
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
