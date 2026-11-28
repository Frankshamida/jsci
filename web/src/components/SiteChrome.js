'use client';

// The site's navbar and footer - one component, used by the home page and the
// pages beside it (News), styled by the landing page's stylesheet (home.css):
// the black-glass bar, the gold brand lockup, the gold Log In button and the
// dark mode switch.
//
// The links are grouped so the bar holds five things instead of eight:
//   About ▾ (Who We Are, Our Pastors, Location)   Plan a Visit
//   Get Involved ▾ (Ministries, Events, ISOM, Sunday Service, Midweek Service)   News
//   Give ▾ (Tithes & Offering - on the Sunday Service page - and Donate)
// On a computer a group opens on hover or click; on a phone the menu lists
// every group under its name. Section links point at the home page
// (/#plan-visit); ON the home page, `onSection` scrolls there smoothly instead.
//
// Signed in, "Log In" gives way to the account: the person's photo (or
// initials) with a green dot, their first name, and a small menu - who they
// are signed in as, Sunday Service, Midweek Service, My giving, their account,
// Dark mode, Log out. It shows on a phone too, beside the menu button, so it
// is always clear who is signed in. A Guest has no dashboard: their home is the
// landing page, and My profile opens over the page they are on.
//
// Dark mode lives with the account: in its menu when signed in, and as a
// quiet moon beside "Log In" when not (a row of its own in a phone's menu) -
// never a gold disc competing with the links.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBranding } from '@/components/BrandingProvider';
import MeetDevelopersButton from '@/components/developers/MeetDevelopersButton';
import { useHomeSections } from '@/components/HomeSectionsProvider';
import { initialsOf, signOutViewer, useViewer } from '@/lib/viewer';

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
      { href: '/sunday-service', label: 'Sunday Service', hint: 'Watch it live, or one you missed' },
      { href: '/midweek', label: 'Midweek Service', hint: 'Our online midweek services' },
    ],
  },
  { href: '/news', label: 'News', page: 'news' },
  {
    label: 'Give',
    items: [
      { href: '/sunday-service#give', label: 'Tithes & Offering', hint: 'Give online, on the Sunday Service page' },
      { href: '/donation', label: 'Donate', hint: 'Help fill the jar for a cause' },
    ],
  },
];

// The site's light and dark mode: kept in the browser, on <body> and <html>.
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.body.classList.contains('dark-mode')); }, []);
  const toggle = useCallback(() => {
    const next = !document.body.classList.contains('dark-mode');
    setDark(next);
    try { localStorage.setItem('darkModeEnabled', next); } catch { /* not saved */ }
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  }, []);
  return [dark, toggle];
}

function Avatar({ viewer, large = false }) {
  return (
    <span className={`hp-acct-avatar ${large ? 'lg' : ''}`}>
      {viewer.profile_picture
        ? <img src={viewer.profile_picture} alt="" referrerPolicy="no-referrer" />
        : initialsOf(viewer)}
      {!large && <i className="hp-acct-dot" aria-hidden="true"></i>}
    </span>
  );
}

// The signed-in account: a chip in the bar and its menu.
function AccountMenu({ viewer, live, onOpen, dark, onToggleDark }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const name = [viewer.firstname, viewer.lastname].filter(Boolean).join(' ');
  const role = viewer.role || 'Guest';

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = () => {
    setOpen((v) => {
      if (!v) onOpen?.();
      return !v;
    });
  };

  const logOut = () => {
    setOpen(false);
    signOutViewer();
  };

  return (
    <div ref={ref} className={`hp-acct ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="hp-acct-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Signed in as ${name}. Open your account menu`}
        onClick={toggle}
      >
        <Avatar viewer={viewer} />
        <span className="hp-acct-name">{viewer.firstname}</span>
        <i className="fas fa-chevron-down hp-acct-chev" aria-hidden="true"></i>
      </button>

      <div className="hp-acct-menu" role="menu">
        <div className="hp-acct-head">
          <Avatar viewer={viewer} large />
          <div>
            <strong>{name}</strong>
            <span className="hp-acct-role">{role}</span>
          </div>
        </div>
        <p className="hp-acct-status"><i className="fas fa-circle-check" aria-hidden="true"></i> You are signed in</p>

        <a href="/sunday-service" role="menuitem" className={live ? 'is-live' : undefined}>
          <i className="fas fa-tower-broadcast" aria-hidden="true"></i>
          <span>
            <strong>Sunday Service</strong>
            <small>{live ? 'We are live right now' : 'Watch it live, or one you missed'}</small>
          </span>
          {live && <span className="hp-live-dot" aria-hidden="true"></span>}
        </a>
        <a href="/midweek" role="menuitem">
          <i className="fas fa-circle-play" aria-hidden="true"></i>
          <span><strong>Midweek Service</strong><small>Our online midweek services</small></span>
        </a>
        <a href="/giving/my" role="menuitem">
          <i className="fas fa-hand-holding-heart" aria-hidden="true"></i>
          <span><strong>My giving</strong><small>Your gifts and their receipts</small></span>
        </a>
        {/* Every role's home is the dashboard, a Guest's too. */}
        <a href="/dashboard#my-profile" role="menuitem">
          <i className="fas fa-user" aria-hidden="true"></i>
          <span><strong>My profile</strong><small>Your details and password</small></span>
        </a>
        <a href="/dashboard" role="menuitem">
          <i className="fas fa-gauge" aria-hidden="true"></i>
          <span><strong>Dashboard</strong><small>Your church dashboard</small></span>
        </a>

        <button type="button" role="menuitemcheckbox" aria-checked={dark} className="hp-acct-theme" onClick={onToggleDark}>
          <i className={`fas ${dark ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true"></i>
          <span><strong>Dark mode</strong></span>
          <span className="hp-switch" aria-hidden="true"></span>
        </button>

        <button type="button" role="menuitem" className="hp-acct-out" onClick={logOut}>
          <i className="fas fa-arrow-right-from-bracket" aria-hidden="true"></i>
          <span><strong>Log out</strong></span>
        </button>
      </div>
    </div>
  );
}

// `loginHref`: where "Log In" goes - with ?next= on a page worth coming back to.
export function SiteNavbar({ current = null, onSection = null, live: liveProp, loginHref = '/login' }) {
  const brand = useBranding();
  // A homepage section a Super Admin hid takes its menu link with it.
  const { linkShown } = useHomeSections();
  const nav = NAV
    .map((n) => (n.items ? { ...n, items: n.items.filter((i) => linkShown(i.href)) } : n))
    .filter((n) => (n.items ? n.items.length > 0 : linkShown(n.href)));
  const { viewer, ready } = useViewer();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(null); // the dropdown that is open
  const [dark, toggleDark] = useDarkMode();
  const [liveFetched, setLiveFetched] = useState(false);
  const live = liveProp ?? liveFetched;
  const navRef = useRef(null);
  const closeTimer = useRef(null);

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
  // A click right after the hover opened it (the pointer arriving, then the
  // click) keeps it open instead of closing it again at once.
  const hoveredAt = useRef(0);
  const enter = (label) => {
    clearTimeout(closeTimer.current);
    if (group !== label) hoveredAt.current = Date.now();
    setGroup(label);
  };
  const clickGroup = (label) => setGroup((g) => (g === label && Date.now() - hoveredAt.current > 400 ? null : label));
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
        {nav.map((n) => (n.items ? (
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
              onClick={() => clickGroup(n.label)}
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
          <a href="/sunday-service" className="hp-btn-live"><span className="hp-live-dot" aria-hidden="true"></span> Live</a>
        )}
        {/* Held invisible until the browser says nobody is signed in, so a
            signed-in visitor never sees "Log In" (or the moon) flash. Signed
            in, Dark mode is in the account's menu instead. */}
        {!viewer && (
          <button
            type="button"
            className={`hp-theme-btn ${ready ? '' : 'is-pending'}`}
            onClick={toggleDark}
            aria-pressed={dark}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <i className={`fas ${dark ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true"></i>
            <span className="hp-theme-label">Dark mode</span>
            <span className="hp-switch" aria-hidden="true"></span>
          </button>
        )}
        {!viewer && <a href={loginHref} className={`hp-btn-login ${ready ? '' : 'is-pending'}`}>Log In</a>}
      </div>

      <div className="hp-navbar-actions">
        {viewer && <AccountMenu viewer={viewer} live={live} dark={dark} onToggleDark={toggleDark} onOpen={() => { setOpen(false); setGroup(null); }} />}
        <button className="hp-nav-toggle" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          <i className={`fas ${open ? 'fa-times' : 'fa-bars'}`}></i>
        </button>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  const brand = useBranding();
  const { linkShown } = useHomeSections();
  const { viewer } = useViewer();
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
            {linkShown('/#about') && <li><a href="/#about">About Us</a></li>}
            {linkShown('/#plan-visit') && <li><a href="/#plan-visit">Plan a Visit</a></li>}
            {linkShown('/#ministries') && <li><a href="/#ministries">Ministries</a></li>}
            {linkShown('/#news') && <li><a href="/#news">Events</a></li>}
            {linkShown('/#isom') && <li><a href="/#isom">ISOM</a></li>}
            <li><a href="/donation">Donate</a></li>
            <li><a href="/news">News</a></li>
          </ul>
        </div>

        <div className="hp-footer-col">
          <h4>Online</h4>
          <ul>
            <li><a href="/sunday-service">Sunday Service</a></li>
            <li><a href="/sunday-service#give">Tithes &amp; Offering</a></li>
            <li><a href="/midweek">Midweek Service</a></li>
            <li><a href="/ministrymobileapp">Ministry App</a></li>
            <li><a href="/">Ask Joy</a></li>
            {viewer ? (
              <>
                <li><a href="/giving/my">My Giving</a></li>
                <li><a href="/dashboard">My Account</a></li>
              </>
            ) : (
              <>
                <li><a href="/login">Member Login</a></li>
                <li><a href="/signup">Create an Account</a></li>
              </>
            )}
          </ul>
        </div>

        <div className="hp-footer-col">
          <h4>Get in Touch</h4>
          <ul>
            {linkShown('/#location') && <li><a href="/#location">Cebu City, Philippines</a></li>}
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
          {' · '}<MeetDevelopersButton />
        </p>
      </div>
    </footer>
  );
}
