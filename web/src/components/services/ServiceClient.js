'use client';

// /sunday-service and /midweek (and each service's own page under them) - one
// page for both, so they look and work the same:
//
//   the dark band with the page's name, the service beside the list of all
//   of them, each with its thumbnail (drawn from its own title, date and
//   speaker - components/midweek/MidweekThumbnail), and a sign-in card in
//   the service's place for somebody without an account (a free Guest one is
//   enough), who comes straight back to the same service after signing in.
//
// What differs:
//   Sunday Service    a Facebook Live; it plays right here. The one live now
//                     is marked Live, and the page refreshes itself when a
//                     service goes live or ends.
//   Midweek Service   a Facebook video; it opens on Facebook (worship songs
//                     usually keep Facebook from letting another website
//                     play it).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { POLL_MS, useSmartPoll } from '@/lib/pollingConfig';
import { getUserRoles } from '@/lib/permissions';
import { signOutViewer, useViewer } from '@/lib/viewer';
import { VIDEO_CATEGORIES, midweekPath, serviceDate } from '@/lib/serviceVideos';
import { SUNDAY_TIME, sundayPath } from '@/lib/sundayService';
import MidweekThumbnail from '@/components/midweek/MidweekThumbnail';
import TithesCard from '@/components/giving/TithesCard';

const KINDS = {
  sunday: {
    name: 'Sunday Service',
    path: sundayPath,
    watchApi: '/api/live-streams/watch',
    plays: true,
    other: { href: '/midweek', label: 'Watch the Midweek Service' },
    manage: '/social-media?tab=sunday',
  },
  midweek: {
    name: 'Midweek Service',
    path: midweekPath,
    watchApi: '/api/service-videos/watch',
    plays: false,
    other: { href: '/sunday-service', label: 'Go to the Sunday Service' },
    manage: '/social-media?tab=midweek',
  },
};

const OPENED_KEY = (userId) => `watchOpened:${userId}`;
function readOpened(userId) {
  try { return JSON.parse(localStorage.getItem(OPENED_KEY(userId)) || '{}') || {}; } catch { return {}; }
}

// The service's thumbnail. The page has its own play button and "Watch on
// Facebook", so the template's small icon is left out.
function Thumb({ item }) {
  return (
    <MidweekThumbnail
      template={item.template}
      title={item.title}
      date={item.date}
      speaker={item.speaker}
      label={item.label}
      showPlayIcon={false}
    />
  );
}

function SignInGate({ item, next, message }) {
  const back = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="wt-gate" role="region" aria-label="Sign in to watch">
      {item && <span className="wt-gate-bg" aria-hidden="true"><Thumb item={item} /></span>}
      <div className="wt-gate-inner">
        <span className="wt-gate-lock" aria-hidden="true"><i className="fas fa-lock"></i></span>
        <h2>Sign in to watch {item ? <span>{item.title}</span> : 'our services'}</h2>
        <p>{message || 'Our services online are for our church family. A free account takes a minute, and a Guest account is all you need.'}</p>
        <div className="wt-gate-btns">
          <a href={`/login${back}`} className="wt-gate-login">Log in to watch</a>
          <a href={`/signup${back}`} className="wt-gate-signup">Create a free account</a>
        </div>
        <small>You will come right back to this service once you are signed in.</small>
      </div>
    </div>
  );
}

// The thumbnail, opening the video on Facebook (a Midweek Service), or held
// while the video is being fetched. The big play button shows on hover and
// keyboard focus only - at rest it would sit on the title, which every
// template puts across the middle.
function Poster({ item, link, waitText, onOpen }) {
  const inside = (
    <>
      <span className="wt-poster-frame">
        <span className="wt-poster-art" aria-hidden="true"><Thumb item={item} /></span>
        <span className="wt-poster-play" aria-hidden="true">
          {link ? <i className="fas fa-play"></i> : <span className="wt-spinner is-dark"></span>}
        </span>
      </span>
      <span className="wt-poster-cta">
        {link && <i className="fab fa-facebook" aria-hidden="true"></i>} {link ? 'Watch on Facebook' : waitText}
      </span>
    </>
  );
  return link ? (
    <a href={link} target="_blank" rel="noopener noreferrer" className="wt-poster" onClick={onOpen} aria-label={`Watch ${item.title} on Facebook (opens Facebook)`}>
      {inside}
    </a>
  ) : (
    <div className="wt-poster is-wait">{inside}</div>
  );
}

// A Sunday Service, playing here.
function Player({ item, src }) {
  if (!src) return <Poster item={item} waitText="Opening the service…" />;
  return (
    <div className="wt-player">
      <iframe
        src={src}
        title={item.title}
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
      ></iframe>
    </div>
  );
}

export default function ServiceClient({ kind = 'midweek', items = [], currentSlug = null }) {
  const K = KINDS[kind] || KINDS.midweek;
  const router = useRouter();
  const { viewer, ready } = useViewer();
  const [filter, setFilter] = useState('all');
  const [media, setMedia] = useState({}); // id -> { src, link } (signed in only)
  const [missing, setMissing] = useState({}); // id -> why it cannot be had
  const [blocked, setBlocked] = useState(null); // { userId, message }
  const [opened, setOpened] = useState({});
  const [shareNote, setShareNote] = useState('');

  useEffect(() => {
    setOpened(viewer?.id && !K.plays ? readOpened(viewer.id) : {});
  }, [viewer?.id, K.plays]);

  const signedIn = ready && !!viewer;
  const isAdmin = signedIn && getUserRoles(viewer).some((r) => r === 'Admin' || r === 'Super Admin');
  const current = items.find((i) => i.slug === currentSlug) || items.find((i) => i.live) || items[0] || null;
  const currentId = current?.id || null;
  const liveNow = items.some((i) => i.live);
  const categories = useMemo(
    () => (kind === 'midweek' ? VIDEO_CATEGORIES.filter((c) => items.some((i) => i.category === c.key)) : []),
    [kind, items],
  );
  const listed = filter === 'all' ? items : items.filter((i) => i.category === filter);
  const isBlocked = signedIn && blocked?.userId === viewer.id;

  // The current service's video, for a signed-in account.
  useEffect(() => {
    if (!viewer?.id || !currentId || media[currentId] || missing[currentId] || blocked?.userId === viewer.id) return undefined;
    let cancelled = false;
    (async () => {
      const res = await fetch(K.watchApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: viewer.id, id: currentId }),
      });
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.status === 401 || res.status === 403) {
        setBlocked({ userId: viewer.id, message: data?.message });
        if (res.status === 401) signOutViewer(); // this browser's account is gone
        return;
      }
      if (res.status === 404) { setMissing((m) => ({ ...m, [currentId]: data?.message || 'This service is no longer on the website.' })); return; }
      if (res.ok && (data?.src || data?.video_url)) {
        setMedia((m) => ({ ...m, [currentId]: { src: data.src || null, link: data.link || data.video_url || null } }));
      }
    })().catch(() => { /* tried again when the service is opened again */ });
    return () => { cancelled = true; };
  }, [viewer?.id, currentId, media, missing, blocked, K.watchApi]);

  // Sunday: going live, or ending, shows here without a reload - at once
  // through Supabase's change feed, and by a slow check in case it is missed.
  const liveIds = items.filter((i) => i.live).map((i) => i.id).sort().join(',');
  useEffect(() => {
    if (kind !== 'sunday' || !supabase) return undefined;
    let timer;
    const channel = supabase
      .channel('sunday-service-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_streams' }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 1500);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [kind, router]);
  const checkLive = useCallback(async () => {
    const res = await fetch('/api/live-streams/public');
    if (!res.ok) return;
    const list = await res.json();
    const now = (Array.isArray(list) ? list : []).map((s) => s.id).sort().join(',');
    if (now !== liveIds) router.refresh();
  }, [liveIds, router]);
  useSmartPoll(checkLive, kind === 'sunday' ? POLL_MS.liveStreams : null, { immediate: false });

  const markOpened = (id) => {
    if (!viewer?.id || !id || K.plays) return;
    setOpened((all) => {
      const next = { ...all, [id]: Date.now() };
      try {
        const kept = Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, 100));
        localStorage.setItem(OPENED_KEY(viewer.id), JSON.stringify(kept));
      } catch { /* not kept */ }
      return next;
    });
  };

  const share = async () => {
    const url = `${window.location.origin}${K.path(current?.slug)}`;
    const text = current ? `${current.title} - ${serviceDate(current.date)?.long || ''}` : `Watch the ${K.name} online`;
    if (navigator.share) {
      try { await navigator.share({ title: current?.title || K.name, text, url }); return; } catch { /* closed, or not allowed */ }
    }
    try { await navigator.clipboard.writeText(url); setShareNote('Link copied'); } catch { setShareNote(url); }
    setTimeout(() => setShareNote(''), 2500);
  };

  const intro = kind === 'sunday'
    ? liveNow
      ? 'We are live now. Join us in worship from wherever you are.'
      : `We go live every Sunday at ${SUNDAY_TIME}. Watch the latest service, or one you missed.`
    : 'Worship and the Word from our online services. Watch the latest, or catch up on one you missed.';

  const head = (
    <section className="wt-head">
      <div className="wt-wrap">
        {liveNow
          ? <span className="wt-eyebrow is-live"><span className="wt-dot" aria-hidden="true"></span> Live now</span>
          : <span className="wt-eyebrow">Watch online</span>}
        <h1>{K.name}</h1>
        <p>{intro}</p>
      </div>
    </section>
  );

  if (!items.length) {
    return (
      <main className="wt-main">
        {head}
        <div className="wt-wrap">
          <section className="wt-empty">
            <h2>{kind === 'sunday' ? 'No service here yet' : 'No service videos yet'}</h2>
            <p>
              {kind === 'sunday'
                ? `When we go live on Sunday at ${SUNDAY_TIME}, the service plays right here. Past services stay here to watch again.`
                : 'Videos of our Online Midweek Service are posted here after each service, so you can watch whenever you are ready.'}
            </p>
            <div className="wt-empty-btns">
              <a href={K.other.href} className="wt-btn">{K.other.label}</a>
              <a href="/" className="wt-btn is-soft">Back to home</a>
            </div>
          </section>
          {kind === 'sunday' && <div className="wt-empty-give"><TithesCard /></div>}
        </div>
      </main>
    );
  }

  const got = current ? media[current.id] : null;
  const date = serviceDate(current?.date);
  const path = K.path(current?.slug);

  return (
    <main className="wt-main">
      {head}

      <div className="wt-wrap wt-layout">
        <div className="wt-primary">
          {!ready ? (
            <div className="wt-frame-wait"><span className="wt-spinner" aria-hidden="true"></span></div>
          ) : !signedIn ? (
            <SignInGate item={current} next={path} />
          ) : isBlocked ? (
            <SignInGate item={current} next={path} message={blocked.message} />
          ) : current && missing[current.id] ? (
            <div className="wt-frame-wait is-note">{missing[current.id]}</div>
          ) : current && K.plays ? (
            <Player item={current} src={got?.src} />
          ) : current ? (
            <Poster item={current} link={got?.link} waitText="Getting the video…" onOpen={() => markOpened(current.id)} />
          ) : null}

          {current && (
            <div className="wt-info">
              <div className="wt-tags">
                {current.live
                  ? <span className="wt-live"><span className="wt-dot" aria-hidden="true"></span> Live now</span>
                  : <span className="wt-cat">{current.label}</span>}
                {date && <span>{date.long}</span>}
                {signedIn && opened[current.id] && <span className="wt-watched">Opened</span>}
              </div>
              <h2>{current.title}</h2>
              {current.speaker && <p className="wt-speaker">{current.speaker}</p>}
              {current.description && <p className="wt-desc">{current.description}</p>}
              <div className="wt-actions">
                {signedIn && got?.link && !isBlocked && (
                  <a
                    href={got.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`wt-btn ${K.plays ? 'is-soft' : 'is-fb'}`}
                    onClick={() => markOpened(current.id)}
                  >
                    <i className="fab fa-facebook" aria-hidden="true"></i> {K.plays ? 'Open on Facebook' : 'Watch on Facebook'}
                  </a>
                )}
                <button type="button" className="wt-btn is-soft" onClick={share}>{shareNote || 'Share'}</button>
                {isAdmin && <a href={K.manage} className="wt-btn is-soft">Manage</a>}
              </div>
              {signedIn && !isBlocked && (
                <p className="wt-fb-note">
                  {K.plays
                    ? 'Not playing? Open it on Facebook instead.'
                    : 'The video opens on Facebook in a new tab. On a phone, it opens in the Facebook app.'}
                </p>
              )}
            </div>
          )}

          {/* Tithes and offerings are given here, on the Sunday Service page. */}
          {kind === 'sunday' && <TithesCard />}
        </div>

        <aside className="wt-list" aria-label="All services">
          <div className="wt-list-head">
            <h3>All services</h3>
            <span>{listed.length} {listed.length === 1 ? 'service' : 'services'}</span>
          </div>
          {categories.length > 1 && (
            <div className="wt-chips" role="tablist" aria-label="Kind of service">
              {[{ key: 'all', label: 'All' }, ...categories].map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={filter === c.key} className={filter === c.key ? 'on' : ''} onClick={() => setFilter(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <ol className="wt-items">
            {listed.map((i) => {
              const isCurrent = i.id === currentId;
              const d = serviceDate(i.date);
              return (
                <li key={i.id}>
                  <Link
                    href={K.path(i.slug)}
                    prefetch={false}
                    className={`wt-item ${isCurrent ? 'is-current' : ''}`}
                    aria-current={isCurrent ? 'page' : undefined}
                  >
                    <span className="wt-thumb"><Thumb item={i} /></span>
                    <span className="wt-item-main">
                      <strong>{i.title}</strong>
                      <small>{[i.speaker, d?.medium].filter(Boolean).join(' · ')}</small>
                      <span className="wt-item-meta">
                        {i.live && <span className="wt-live is-small"><span className="wt-dot" aria-hidden="true"></span> Live</span>}
                        {isCurrent && <span className="wt-now">Showing</span>}
                        {signedIn && opened[i.id] && <span className="wt-watched">Opened</span>}
                        {!signedIn && <i className="fas fa-lock wt-item-lock" aria-label="Sign in to watch"></i>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </main>
  );
}
