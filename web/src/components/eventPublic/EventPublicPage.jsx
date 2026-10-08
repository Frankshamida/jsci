'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FEEDBACK_MAX_NAME, FEEDBACK_MAX_WORDS, countWords,
  daysWith, formatClock, formatDay, groupProgramme, programmeKind, publicEventTitle, shortDay,
} from '@/lib/eventPublic';
import { normalizeUid, isPlausibleUid, wedgeCapture, WEDGE_IDLE_RESET_MS } from '@/lib/rfid';
import {
  STORY_H, STORY_LOGO_SRC, STORY_MAX, STORY_POS, STORY_THEMES, STORY_VIDEO_MAX_S, STORY_VIDEO_SRC, STORY_W, STORY_ZOOM_MAX,
  canRecordStory, recordStory, drawMusicSticker,
  drawStory, loadStoryArt, loadStoryFonts, loadStoryImage, storyLayouts, storyThemes, storyPan, storyPhotoUrl, storySlotAt, storySlots, storyZoom,
} from '@/lib/storyCard';
import { drawIdBack, drawIdFront, idQrText } from '@/lib/idCard';
import { makeZip } from '@/lib/zipStore';
import { fallbackFacts, loadBibleFacts } from '@/lib/bibleFacts';
import { useSongPlayer } from '@/components/songPlayer/useSongPlayer';
import { PlayerControls, SongRow, VinylStage } from '@/components/songPlayer/PlayerParts';
import { MusicCard, MusicPicker, makeAudioContext, useSegmentPreview } from './StoryMusic';

// The page an attendee's ID QR opens: /events/cebu-miracle-working-god.
//
//   Programme     the default view, open to anyone with the link. Items whose
//                 time has passed read Done; once the whole event is over it
//                 says so, and offers Feedback (named or anonymous).
//   Event Photos  open to anyone too, by day, each photo with a heart anyone
//                 can give - no login, one per browser.
//   Profile       the attendee's virtual ID, front and back  } only after
//   Extras        what they availed, and their room          } Enter credentials
//
// Enter credentials (beside Feedback, under the programme) is the attendee's
// password (LASTNAME@2026) or RFID card, in a pop-up. It is what opens
// Profile and Extras; the photos no longer need it.
//
// The QR carries ?t=<code>, the attendee's own code. It is remembered per
// event, so switching tabs or coming back later still says their name, and it
// is what the sign-in checks the password or card against.

const store = {
  get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } },
  del(key) { try { window.localStorage.removeItem(key); } catch { /* private mode */ } },
};

// Light / dark, shared with the rest of the site: the same key and class the
// dashboard uses, and the root layout applies it before the first paint.
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains('dark-mode')); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark-mode', next);
    document.body.classList.toggle('dark-mode', next);
    store.set('darkModeEnabled', next ? 'true' : 'false');
  };
  return [dark, toggle];
}

// Every tab has its own address - the Programme too, /events/<slug>/programme:
// the bare /events/<slug> is what an old ID's QR holds, and for some events it
// opens the conference chooser (QR_CHOOSER_SLUGS, lib/eventPublic.js).
const VIEWS = ['programme', 'photos', 'profile', 'extras'];
const NO_SONGS = [];
const viewPath = (slug, view, code) => {
  const base = `/events/${slug}${VIEWS.includes(view) ? `/${view}` : ''}`;
  return code ? `${base}?t=${encodeURIComponent(code)}` : base;
};
// Which tab an address is: /events/<slug>[/photos|/profile|/extras].
const viewOf = (pathname) => VIEWS.find((v) => pathname.endsWith(`/${v}`)) || 'programme';

// ---- Motion ----
// Somebody who has asked their phone for less motion gets none of it.
const calm = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The highlight behind the chosen tab glides to the next one instead of
// jumping: the box measures its active child and puts --ind-x/-y/-w/-h on
// itself, and an .ep-ind inside it is drawn from those. It only starts to
// glide once it has been placed, so it never flies in from the corner.
function useSlidingIndicator(ref, active) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const place = () => {
      const on = box.querySelector('[aria-selected="true"], [aria-current="page"]');
      if (!on) { box.style.setProperty('--ind-w', '0px'); return; }
      box.style.setProperty('--ind-x', `${on.offsetLeft}px`);
      box.style.setProperty('--ind-y', `${on.offsetTop}px`);
      box.style.setProperty('--ind-w', `${on.offsetWidth}px`);
      box.style.setProperty('--ind-h', `${on.offsetHeight}px`);
    };
    place();
    const ready = requestAnimationFrame(() => box.classList.add('ind-ready'));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(box);
    return () => { cancelAnimationFrame(ready); ro?.disconnect(); };
  }, [ref, active]);
}

// "Fri, Oct 2 - Sun, Oct 4, 2026", from the event's wall-clock dates.
const dateRange = (evt) => {
  const day = (v) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const a = day(evt?.event_date);
  const b = day(evt?.end_date);
  if (!a) return '';
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (!b || b.getTime() === a.getTime()) return a.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${a.toLocaleDateString('en-US', opts)} – ${b.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
};

// Event times are wall-clock - typed in the Philippines and stored with a
// "+00:00" that does not mean UTC - so they are read off their own digits.
// A date with no time is the end of that day.
const wallClock = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return m[4] ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(+m[1], +m[2] - 1, +m[3], 23, 59);
};

// Over: past the event's end, or past its last programme item if that runs
// later. With no end date, the end of its first day.
const eventIsOver = (evt, items, nowMs) => {
  const ends = [
    wallClock(evt?.end_date) || wallClock(String(evt?.event_date || '').slice(0, 10)),
    ...(items || []).map((it) => {
      const day = String(it.day_date || '').slice(0, 10);
      const t = String(it.end_time || it.start_time || '').slice(0, 5);
      return day && t ? wallClock(`${day}T${t}`) : null;
    }),
  ].filter(Boolean);
  return ends.length > 0 && nowMs >= Math.max(...ends.map((d) => d.getTime()));
};

// This browser's heart id: random, kept in local storage, no account behind
// it. The server takes one heart per photo per id, so tapping again takes it
// back rather than adding another.
const visitorId = () => {
  let id = store.get('ep-visitor');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || '')) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    store.set('ep-visitor', id);
  }
  return id;
};

export default function EventPublicPage({ slug, view: initialView = 'programme' }) {
  const [view, setView] = useState(initialView);
  const [code, setCode] = useState('');
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');

  // The code from the QR, else the one remembered for this event.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('t') || '';
    const key = `evt-code:${slug}`;
    if (fromUrl) store.set(key, fromUrl);
    setCode(fromUrl || store.get(key) || '');
  }, [slug]);

  useEffect(() => {
    let live = true;
    const t = new URLSearchParams(window.location.search).get('t') || store.get(`evt-code:${slug}`) || '';
    fetch(`/api/events/public?slug=${encodeURIComponent(slug)}${t ? `&t=${encodeURIComponent(t)}` : ''}`)
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        // Their ID belongs to another event: go to their own event's page.
        if (data.redirect) {
          window.location.replace(viewPath(data.redirect, viewOf(window.location.pathname), t));
          return;
        }
        if (!data.success) { setLoadError(data.message || 'Event not found'); return; }
        setInfo(data);
      })
      .catch(() => live && setLoadError('Could not load the event. Check your connection and try again.'));
    return () => { live = false; };
  }, [slug]);

  // Tabs change the address without reloading, and Back goes back a tab.
  // Which way the new tab slides in: from the right going along the tabs,
  // from the left coming back.
  const [viewDir, setViewDir] = useState('none');
  const viewRef = useRef(view);
  viewRef.current = view;
  const dirTo = (next) => (VIEWS.indexOf(next) >= VIEWS.indexOf(viewRef.current) ? 'fwd' : 'back');
  useEffect(() => {
    const onPop = () => {
      const next = viewOf(window.location.pathname);
      if (next === viewRef.current) return;
      setViewDir(dirTo(next));
      setView(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (next) => {
    if (next === view) return;
    window.history.pushState(null, '', viewPath(slug, next, code));
    setViewDir(dirTo(next));
    setView(next);
    window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' });
  };
  const tabsRef = useRef(null);
  const pageRef = useRef(null);

  const [dark, toggleDark] = useDarkMode();
  // The name in the welcome is only there while the photos are unlocked: it
  // comes from the password or card, and Lock takes it away again.
  const nameKey = `evt-name:${slug}`;
  const [unlockedName, setUnlockedName] = useState('');
  const [forgotten, setForgotten] = useState(false);
  // Unlocked with the password or card: only then is there a Profile tab.
  // null until the browser has been asked, so /profile is not sent away early.
  const [unlocked, setUnlocked] = useState(null);
  useEffect(() => {
    const has = !!store.get(`evt-pass:${slug}`);
    setUnlocked(has);
    if (has) setUnlockedName(store.get(nameKey) || '');
  }, [slug, nameKey]);
  const onUnlockedName = useCallback((name, unlockedCode) => {
    setForgotten(false);
    setUnlocked(true);
    setUnlockedName(name || '');
    if (name) store.set(nameKey, name); else store.del(nameKey);
    // Somebody other than the QR's holder unlocked on this phone: remember
    // them instead, so the next unlock does not start from the wrong person.
    if (unlockedCode) {
      store.set(`evt-code:${slug}`, unlockedCode);
      setCode(unlockedCode);
    }
  }, [nameKey, slug]);
  const onLocked = useCallback(() => {
    setUnlocked(false);
    setUnlockedName('');
    setForgotten(true);
    store.del(nameKey);
    // A code remembered from an older QR would bring the name straight back.
    store.del(`evt-code:${slug}`);
    setCode('');
  }, [nameKey, slug]);
  // ---- Enter credentials ----
  // The password or card, in a pop-up over the Programme. Signing in is what
  // brings the Profile and Extras tabs; it opens straight onto the Profile so
  // the attendee sees it worked.
  const [credsOpen, setCredsOpen] = useState(false);
  const onCredentials = useCallback((result) => {
    store.set(`evt-pass:${slug}`, result.pass);
    onUnlockedName(result.name || '', result.code || '');
    setCredsOpen(false);
    const nextCode = result.code || code;
    window.history.pushState(null, '', viewPath(slug, 'profile', nextCode));
    setView('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [slug, code, onUnlockedName]);
  const signOut = useCallback(() => {
    store.del(`evt-pass:${slug}`);
    onLocked();
  }, [slug, onLocked]);
  // /profile or /extras while signed out (an old link, or Lock pressed
  // there): back to the Programme, with the sign-in already open.
  useEffect(() => {
    if (unlocked !== false || (view !== 'profile' && view !== 'extras')) return;
    window.history.replaceState(null, '', viewPath(slug, 'programme', code));
    setView('programme');
    if (!forgotten) setCredsOpen(true);
  }, [unlocked, view, slug, code, forgotten]);

  // ---- Over, and feedback ----
  // Whether the event has finished, by its own end time - checked every
  // minute, so a page left open turns over to Done by itself.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // What the holder availed, and where they are sleeping. Asked for as soon as
  // they are unlocked, because it decides whether there is an Extras tab at
  // all - and asked again each time the tab is opened, so a room given at the
  // desk a minute ago shows up without a reload.
  const [extrasInfo, setExtrasInfo] = useState(null); // null = not known yet
  useEffect(() => {
    if (!unlocked) { setExtrasInfo(null); return undefined; }
    const pass = store.get(`evt-pass:${slug}`);
    if (!pass) return undefined;
    let live = true;
    fetch(`/api/events/public/extras?slug=${encodeURIComponent(slug)}`, { headers: { 'x-event-pass': pass } })
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        if (data.success) setExtrasInfo({ extras: data.extras || [], accommodation: data.accommodation || null });
        else setExtrasInfo({ extras: [], accommodation: null, error: data.locked ? '' : (data.message || '') });
      })
      .catch(() => live && setExtrasInfo((cur) => cur || { extras: [], accommodation: null, error: 'Could not load your extras. Check your connection.' }));
    return () => { live = false; };
  }, [unlocked, slug, view === 'extras']); // eslint-disable-line react-hooks/exhaustive-deps
  const hasExtras = (extrasInfo?.extras?.length || 0) > 0;
  // /extras for somebody with nothing extra (an old link): their profile instead.
  useEffect(() => {
    if (view !== 'extras' || !unlocked || !extrasInfo || hasExtras || extrasInfo.error) return;
    window.history.replaceState(null, '', viewPath(slug, 'profile', code));
    setView('profile');
  }, [view, unlocked, extrasInfo, hasExtras, slug, code]);
  const guestName = unlockedName || (forgotten ? '' : info?.guest?.name) || '';

  // Songs on Worship items, played the way Spotify plays a playlist: one
  // player for the whole page (the music keeps going across tabs), a full
  // Now Playing screen, and a bar at the bottom when that is minimised.
  // `lineup` is the Worship item being played - next / previous move through
  // its songs, and the player says which service it is playing from.
  const songs = info?.songs || NO_SONGS;
  const songsById = useMemo(() => new Map(songs.map((x) => [x.id, x])), [songs]);
  const [lineup, setLineup] = useState(null); // null | { item, ids }
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const player = useSongPlayer({ songs, order: lineup?.ids || NO_SONGS });
  const playLineup = (item, ids, songId) => {
    setLineup({ item, ids });
    player.playSong(songId || ids[0]);
    setNowPlayingOpen(true);
  };
  const stopLineup = () => {
    player.pause();
    setLineup(null);
    setNowPlayingOpen(false);
  };
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), []);
  const showMiniPlayer = !!lineup && !!player.current && !nowPlayingOpen;

  // The tab bar's height, for whatever sticks just below it (the day tabs),
  // and the highlight behind its active tab - measured again whenever the
  // tabs themselves change (Profile and Extras appear once signed in).
  const tabsKey = `${view}|${!!info}|${!!unlocked}|${hasExtras}`;
  useLayoutEffect(() => {
    const bar = tabsRef.current;
    const page = pageRef.current;
    if (!bar || !page) return undefined;
    const put = () => page.style.setProperty('--ep-tabs-h', `${bar.offsetHeight}px`);
    put();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(put) : null;
    ro?.observe(bar);
    return () => ro?.disconnect();
  }, [tabsKey]);
  useSlidingIndicator(tabsRef, tabsKey);

  if (loadError) {
    return (
      <main className="ep-page ep-center">
        <div className="ep-missing">
          <i className="fas fa-calendar-xmark"></i>
          <h1>Event not found</h1>
          <p>{loadError}</p>
          <a className="ep-btn" href="/">Go to the home page</a>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="ep-page ep-center">
        <div className="ep-loading"><span className="ep-spinner" /> Loading event…</div>
      </main>
    );
  }

  const { event } = info;
  const when = dateRange(event);
  const over = eventIsOver(event, info.programme, nowMs);

  return (
    <main ref={pageRef} className={`ep-page ${showMiniPlayer ? 'has-mini-player' : ''}`}>
      <header className="ep-hero">
        {event.image_url && <div className="ep-hero-bg" style={{ backgroundImage: `url("${event.image_url}")` }} />}
        <button
          type="button"
          className="ep-theme"
          onClick={toggleDark}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={dark ? 'Light mode' : 'Dark mode'}
        >
          <i className={`fas ${dark ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
        <div className="ep-hero-in">
          {/* Named the same as its card on Choose your conference, so the
              poster carries over from that page to this one. */}
          {event.image_url && (
            <img className="ep-hero-poster" src={event.image_url} alt="" style={{ viewTransitionName: `ep-poster-${slug}` }} />
          )}
          <div className="ep-hero-text">
            <h1>{publicEventTitle(event)}</h1>
            {guestName && <p className="ep-welcome"><i className="fas fa-hand-sparkles"></i> Welcome, {guestName}!</p>}
            <div className="ep-meta">
              {when && <span><i className="fas fa-calendar-days"></i> {when}</span>}
              {event.location && <span><i className="fas fa-location-dot"></i> {event.location}</span>}
            </div>
          </div>
        </div>
      </header>

      <nav ref={tabsRef} className="ep-tabs has-ind" aria-label="Event sections">
        {/* The gold highlight, gliding to whichever tab is open. */}
        <span className="ep-ind" aria-hidden="true" />
        <a
          href={viewPath(slug, 'programme', code)}
          className={view === 'programme' ? 'active' : ''}
          aria-current={view === 'programme' ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); go('programme'); }}
        >
          <i className="fas fa-list-ol"></i><span>Programme</span>
        </a>
        <a
          href={viewPath(slug, 'photos', code)}
          className={view === 'photos' ? 'active' : ''}
          aria-current={view === 'photos' ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); go('photos'); }}
        >
          <i className="fas fa-images"></i><span>Event Photos</span>
        </a>
        {unlocked && (
          <a
            href={viewPath(slug, 'profile', code)}
            className={`ep-tab-new ${view === 'profile' ? 'active' : ''}`}
            aria-current={view === 'profile' ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); go('profile'); }}
          >
            <i className="fas fa-id-badge"></i><span>Profile</span>
          </a>
        )}
        {unlocked && hasExtras && (
          <a
            href={viewPath(slug, 'extras', code)}
            className={`ep-tab-new ${view === 'extras' ? 'active' : ''}`}
            aria-current={view === 'extras' ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); go('extras'); }}
          >
            <i className="fas fa-gift"></i><span>Extras</span>
          </a>
        )}
      </nav>

      <section className="ep-body">
        {/* A new tab slides in from the side it is on, and fades up. */}
        <div key={view} className={`ep-view is-${viewDir}`}>
        {view === 'programme' && (
          <>
            {over && (
              <div className="ep-done-banner" role="status">
                <i className="fas fa-flag-checkered"></i>
                <div>
                  <strong>This event is done</strong>
                  <span>Thank you for being with us! We would love to hear how it went.</span>
                </div>
              </div>
            )}
            <Programme
              event={event}
              items={info.programme}
              over={over}
              songsById={songsById}
              songsPaused={!!info.songsPaused}
              player={player}
              lineup={lineup}
              onPlayLineup={playLineup}
            />
            {/* Feedback once it is over; the attendee's sign-in beside it,
                always - it is what opens Profile and Extras. */}
            <div className="ep-after">
              {over && (
                <button type="button" className="ep-btn" onClick={() => setFeedbackOpen(true)}>
                  <i className="fas fa-comment-dots"></i> Give Feedback
                </button>
              )}
              {unlocked ? (
                <div className="ep-signed">
                  <span><i className="fas fa-circle-check"></i> Signed in{guestName ? ` as ${guestName}` : ''}</span>
                  <button type="button" className="ep-link" onClick={signOut}><i className="fas fa-right-from-bracket"></i> Sign out</button>
                </div>
              ) : (
                <button type="button" className="ep-btn ep-btn-ghost" onClick={() => setCredsOpen(true)}>
                  <i className="fas fa-user-lock"></i> Enter Credentials
                </button>
              )}
            </div>
          </>
        )}
        {view === 'photos' && <Photos event={event} slug={slug} name={guestName} />}
        {view === 'profile' && unlocked && <Profile slug={slug} code={code} year={info.passwordYear} onName={onUnlockedName} onLock={onLocked} />}
        {view === 'extras' && unlocked && <Extras info={extrasInfo} />}
        </div>
      </section>

      {credsOpen && (
        <Modal onClose={() => setCredsOpen(false)} label="Enter credentials">
          <Unlock
            slug={slug} code={code} year={info.passwordYear} onUnlocked={onCredentials}
            icon="fa-user-lock" title="Enter Credentials"
            sub="For attendees. Sign in with your password or your RFID card to see your Profile and Extras."
            cta="Sign In"
          />
        </Modal>
      )}
      {feedbackOpen && (
        <Modal onClose={() => setFeedbackOpen(false)} label="Give feedback">
          <FeedbackForm slug={slug} eventTitle={publicEventTitle(event)} defaultName={guestName} onClose={() => setFeedbackOpen(false)} />
        </Modal>
      )}

      <audio {...player.audioProps} />
      {/* Spotify's own player, for the lineup's Spotify songs. Always on the
          page (moving an iframe would stop the song), shown while one is on. */}
      <div
        ref={player.spotifyHostRef}
        className={`ep-spotify-dock ${nowPlayingOpen ? 'is-np' : 'is-mini'}`}
        hidden={!(lineup && player.isSpotify)}
      />
      {showMiniPlayer && (
        <MiniPlayer player={player} lineup={lineup} onOpen={() => setNowPlayingOpen(true)} onClose={stopLineup} />
      )}
      {nowPlayingOpen && lineup && player.current && (
        <NowPlaying player={player} lineup={lineup} songsById={songsById} onClose={closeNowPlaying} />
      )}

      {/* The same lockup as the top of the dashboard sidebar. */}
      <footer className="ep-foot">
        <img src="/assets/LOGO.png" alt="Joyful Sound Church International logo" className="ep-foot-logo" />
        <span className="ep-foot-name">Joyful Sound Church</span>
        <span className="ep-foot-sub">International</span>
      </footer>
    </main>
  );
}

// ============================================================
// Programme
// ============================================================

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowClock = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Day 1 / Day 2 ... - one tab per day of the event, with "Day N" and its date.
// A segmented control: the highlight slides from day to day.
function DayTabs({ days, value, onChange, all }) {
  const ref = useRef(null);
  useSlidingIndicator(ref, `${value}|${days.join(',')}|${all || ''}`);
  return (
    <div ref={ref} className="ep-days has-ind" role="tablist">
      <span className="ep-ind" aria-hidden="true" />
      {all && (
        <button type="button" role="tab" aria-selected={value === 'all'} className={value === 'all' ? 'active' : ''} onClick={() => onChange('all')}>
          <span>All Days</span>
          <small>{all}</small>
        </button>
      )}
      {days.map((d, i) => (
        <button
          key={d}
          type="button"
          role="tab"
          aria-selected={d === value}
          className={d === value ? 'active' : ''}
          onClick={() => onChange(d)}
        >
          <span>Day {i + 1}</span>
          <small>{shortDay(d)}</small>
        </button>
      ))}
    </div>
  );
}

const lineupLength = (list) => {
  const total = list.reduce((sum, x) => sum + (Number(x.duration_seconds) || 0), 0);
  if (!total) return '';
  const min = Math.round(total / 60);
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`;
};

const lineupWhen = (item) => [formatClock(item.start_time), item.day_date ? shortDay(item.day_date) : ''].filter(Boolean).join(' · ');

// The songs on a Worship item - its lineup. A button drops the list down;
// Play (or any song) starts the lineup and opens the Now Playing screen.
// Uploaded songs and songs saved from Spotify make one lineup, in the order
// the Admin set; a Spotify song carries the Spotify logo.
function WorshipSongs({ item, songsById, paused, player, lineup, onPlayLineup }) {
  const [open, setOpen] = useState(false);
  const list = useMemo(
    () => (item.song_ids || []).map((id) => songsById.get(id)).filter(Boolean),
    [item.song_ids, songsById],
  );
  const ids = useMemo(() => list.map((x) => x.id), [list]);
  // This service's lineup is the one on the record.
  const isThisLineup = lineup?.item?.id === item.id && ids.includes(player.currentId);
  const playingHere = isThisLineup && player.playing;

  if (!paused && !list.length) return null;

  const playAll = () => (isThisLineup ? player.togglePlay() : onPlayLineup(item, ids, ids[0]));
  const rowPlayer = {
    ...player,
    playSong: (id) => {
      if (isThisLineup && id === player.currentId) { player.togglePlay(); return; }
      onPlayLineup(item, ids, id);
    },
  };

  return (
    <div className={`ep-songs ${open ? 'is-open' : ''} ${isThisLineup ? 'is-live' : ''}`}>
      <button type="button" className="ep-songs-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <i className="fas fa-music"></i>
        <span>{paused && !list.length ? 'Song lineup' : `Song lineup · ${list.length}`}</span>
        {playingHere && <span className="sp-eq" aria-label="Playing"><i /><i /><i /></span>}
        <i className="fas fa-chevron-down ep-songs-chevron"></i>
      </button>

      {open && paused && !list.length && (
        <p className="ep-songs-paused">
          <i className="fas fa-circle-pause"></i> Song playback is paused for now. Please sing along with the worship team!
        </p>
      )}
      {open && list.length > 0 && (
        <div className="ep-lineup sp-scope">
          <div className="ep-lineup-head">
            <img src={(isThisLineup ? player.current : list[0])?.cover_thumb_url || list[0].cover_url} alt="" />
            <div className="ep-lineup-info">
              <small>Worship lineup</small>
              <strong>{item.title}</strong>
              <span>{list.length} {list.length === 1 ? 'song' : 'songs'}{lineupLength(list) ? ` · ${lineupLength(list)}` : ''}</span>
            </div>
            <button type="button" className="ep-lineup-play" onClick={playAll} aria-label={playingHere ? 'Pause' : 'Play lineup'}>
              <i className={`fas ${playingHere ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
          </div>
          {isThisLineup && (
            <p className="ep-lineup-now">
              <span className="sp-eq"><i /><i /><i /></span>
              {player.playing ? 'Now playing from this lineup' : 'Paused'} &middot; song {ids.indexOf(player.currentId) + 1} of {ids.length}
            </p>
          )}
          <ul className="sp-list ep-lineup-list">
            {list.map((song, i) => <SongRow key={song.id} song={song} index={i} player={rowPlayer} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

// Full-screen on a phone, a sheet on a wide screen: the spinning record, the
// controls, and the rest of the lineup - with the service it is playing from
// at the top, the way Spotify says "Playing from playlist".
function NowPlaying({ player, lineup, songsById, onClose }) {
  const touchY = useRef(null);
  const list = lineup.ids.map((id) => songsById.get(id)).filter(Boolean);
  const pos = list.findIndex((x) => x.id === player.currentId);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Swipe down on the top part to minimise.
  const swipe = {
    onTouchStart: (e) => { touchY.current = e.touches[0].clientY; },
    onTouchEnd: (e) => {
      if (touchY.current !== null && e.changedTouches[0].clientY - touchY.current > 80) onClose();
      touchY.current = null;
    },
  };

  return (
    <div className="ep-np-backdrop" onClick={onClose}>
      <div className={`ep-np sp-scope sp-compact ${player.isSpotify ? 'has-spotify' : ''}`} role="dialog" aria-modal="true" aria-label="Now playing" onClick={(e) => e.stopPropagation()}>
        <div className="ep-np-top" {...swipe}>
          <span className="ep-np-grab" aria-hidden="true" />
          <div className="ep-np-head">
            <button type="button" className="ep-np-down" onClick={onClose} aria-label="Minimise player">
              <i className="fas fa-chevron-down"></i>
            </button>
            <div className="ep-np-from">
              <small>Playing from lineup</small>
              <strong>{lineup.item.title}</strong>
              <span>{lineupWhen(lineup.item)}</span>
            </div>
            <span className="ep-np-count">{pos + 1}/{list.length}</span>
          </div>
          <div className="ep-np-stage">
            <VinylStage song={player.current} playing={player.playing} />
          </div>
        </div>

        <PlayerControls player={player} canStep={list.length > 1} />

        <div className="ep-np-queue">
          <h4><i className="fas fa-list-ol"></i> {lineup.item.title} lineup <em>{list.length}</em></h4>
          <ul className="sp-list">
            {list.map((song, i) => <SongRow key={song.id} song={song} index={i} player={player} />)}
          </ul>
        </div>
      </div>
    </div>
  );
}

// The bar at the bottom while the Now Playing screen is minimised - playing or
// paused, like Spotify's. Tap it to open the screen again; x stops the lineup.
function MiniPlayer({ player, lineup, onOpen, onClose }) {
  const song = player.current;
  const busy = player.loadingPct !== null;
  const pct = player.duration > 0 ? Math.min(100, (player.time / player.duration) * 100) : 0;
  return (
    <div className="ep-mini sp-scope" role="region" aria-label="Now playing">
      <span className="ep-mini-bar" style={{ width: `${pct}%` }} />
      <button type="button" className="ep-mini-open" onClick={onOpen} aria-label="Open player">
        <span className={`ep-mini-disc ${player.playing ? 'is-playing' : ''}`}>
          <img src="/Playlist/Vinyl.png" alt="" />
          <img className="ep-mini-label" src={song.cover_label_url || song.cover_url} alt="" />
        </span>
        <span className="ep-mini-text">
          <strong>{song.title}</strong>
          <small>{busy ? 'Loading song...' : `${song.artist} · ${lineup.item.title}`}</small>
        </span>
      </button>
      <button type="button" className="ep-mini-play" onClick={player.togglePlay} aria-label={busy ? 'Cancel' : player.playing ? 'Pause' : 'Play'}>
        <i className={`fas ${busy ? 'fa-spinner fa-spin' : player.playing ? 'fa-pause' : 'fa-play'}`}></i>
      </button>
      <button type="button" onClick={() => player.step(1)} disabled={lineup.ids.length < 2} aria-label="Next"><i className="fas fa-forward-step"></i></button>
      <button type="button" className="ep-mini-close" onClick={onClose} aria-label="Stop"><i className="fas fa-times"></i></button>
    </div>
  );
}

function Programme({ event, items, over = false, songsById, songsPaused = false, player, lineup, onPlayLineup }) {
  // Every day the event runs has a tab, even one with nothing on it yet.
  const days = useMemo(() => {
    const grouped = new Map(groupProgramme(items).map((g) => [g.day, g.rows]));
    return daysWith(event, [...grouped.keys()]).map((d) => ({ day: d, rows: grouped.get(d) || [] }));
  }, [event, items]);
  // Opens on today when the event is on, else the first day.
  const [day, setDay] = useState(() => (days.find((d) => d.day === todayIso()) || days[0])?.day || '');
  // Day 1 -> Day 2 slides in from the right, back again from the left; and
  // somebody scrolled far down the day lands back at its top.
  const [dayDir, setDayDir] = useState('none');
  const topRef = useRef(null);
  const pickDay = (d) => {
    if (d === day) return;
    const at = (x) => days.findIndex((g) => g.day === x);
    setDayDir(at(d) > at(day) ? 'fwd' : 'back');
    setDay(d);
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  };
  const [clock, setClock] = useState(nowClock);
  useEffect(() => {
    const id = setInterval(() => setClock(nowClock()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!items?.length) {
    // Over, and no programme was ever posted: "coming soon" would be wrong,
    // and the Done banner above already says what there is to say.
    if (over) return null;
    return (
      <div className="ep-empty">
        <i className="fas fa-list-ol"></i>
        <h2>The programme is coming soon</h2>
        <p>Check back here for the schedule of sessions, speakers and meals.</p>
      </div>
    );
  }

  const current = days.find((d) => d.day === day) || days[0];
  const isToday = current.day === todayIso();
  // "Now" is the latest item that has started, until the next one does.
  const nowId = isToday && !over
    ? [...current.rows].reverse().find((r) => String(r.start_time).slice(0, 5) <= clock
      && (!r.end_time || String(r.end_time).slice(0, 5) > clock))?.id
    : null;
  // Done: an earlier day, or today and its time has passed - its end, or for
  // an item with no end, its start once something later has begun (that is
  // what makes it not "now" any more). Everything, once the event is over.
  const today = todayIso();
  const isDone = (r) => {
    if (r.id === nowId) return false;
    if (over) return true;
    const dayKey = String(r.day_date || '').slice(0, 10);
    if (dayKey < today) return true;
    if (dayKey > today) return false;
    return String(r.end_time || r.start_time || '').slice(0, 5) <= clock;
  };

  return (
    <div className="ep-programme" ref={topRef}>
      {days.length > 1 && <DayTabs days={days.map((d) => d.day)} value={current.day} onChange={pickDay} />}
      <div key={current.day} className={`ep-dayview is-${dayDir}`}>
      <h2 className="ep-day-title">{formatDay(current.day)}</h2>

      {current.rows.length === 0 && (
        <div className="ep-empty">
          <i className="fas fa-calendar-day"></i>
          <h2>Day {days.indexOf(current) + 1} is coming soon</h2>
          <p>The schedule for this day will appear here.</p>
        </div>
      )}
      <ol className="ep-timeline">
        {current.rows.map((it) => {
          const kind = programmeKind(it.kind);
          const done = isDone(it);
          return (
            <li key={it.id} className={`ep-item ep-kind-${kind.key} ${it.id === nowId ? 'is-now' : ''} ${done ? 'is-done' : ''}`}>
              <div className="ep-time">
                <strong>{formatClock(it.start_time)}</strong>
                {it.end_time && <span>{formatClock(it.end_time)}</span>}
              </div>
              <div className="ep-dot"><i className={`fas ${done ? 'fa-check' : kind.icon}`}></i></div>
              <div className="ep-card">
                <div className="ep-card-top">
                  <span className="ep-chip">{kind.label}</span>
                  {it.id === nowId && <span className="ep-now">Happening now</span>}
                  {done && <span className="ep-done-chip"><i className="fas fa-check"></i> Done</span>}
                </div>
                <h3>{it.title}</h3>
                {it.speaker && <p className="ep-speaker"><i className="fas fa-user"></i> {it.speaker}</p>}
                {it.venue && <p className="ep-venue"><i className="fas fa-location-dot"></i> {it.venue}</p>}
                {it.notes && <p className="ep-notes">{it.notes}</p>}
                {kind.key === 'worship' && it.song_ids?.length > 0 && player && songsById && (
                  <WorshipSongs
                    item={it}
                    songsById={songsById}
                    paused={songsPaused}
                    player={player}
                    lineup={lineup}
                    onPlayLineup={onPlayLineup}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      </div>
    </div>
  );
}

// ============================================================
// Photos
// ============================================================

// Photos per page of the grid, and the most that go in one download - a
// phone holds every photo of a download in memory at once (full size, about
// 3-6 MB each) until it is saved.
const PHOTOS_PER_PAGE = 24;
const DOWNLOAD_MAX = 25;

function Photos({ event, slug, name }) {
  const [photos, setPhotos] = useState(null);
  // false until event_feedback_and_photo_hearts.sql is run: no hearts shown,
  // rather than hearts that cannot be pressed.
  const [heartsReady, setHeartsReady] = useState(false);
  const [heartError, setHeartError] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(-1);
  const [day, setDay] = useState('all');
  const [page, setPage] = useState(1);
  const gridTopRef = useRef(null);
  // Story mode: the attendee picks up to STORY_MAX photos, in order.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState([]);
  const [story, setStory] = useState(null);
  const togglePick = (id) => setPicked((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    return cur.length >= STORY_MAX ? cur : [...cur, id];
  });
  const stopPicking = () => { setPicking(false); setPicked([]); };
  // Download mode: tick photos, then download them all at once.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const toggleSelect = (id) => setSelected((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    return cur.length >= DOWNLOAD_MAX ? cur : [...cur, id];
  });
  const stopSelecting = () => { setSelecting(false); setSelected([]); };
  // What is being downloaded right now - the overlay with the progress and
  // the fun facts is open while this is set.
  const [download, setDownload] = useState(null);
  // The grid, the full view and the picker are all covered for screenshots.
  const covered = useScreenGuard();
  const block = (e) => e.preventDefault();

  // Day 1, Day 2 ... for every day the event runs, whether or not its
  // photos are in yet - plus any day a photo is dated that is not one of them.
  const days = useMemo(
    () => daysWith(event, (photos || []).map((p) => p.day).filter(Boolean)),
    [event, photos],
  );
  const shown = useMemo(
    () => (day === 'all' ? photos || [] : (photos || []).filter((p) => p.day === day)),
    [photos, day],
  );

  // The last list is shown at once from this tab's memory, and the server is
  // asked every time anyway - the photos themselves are cached there, and the
  // hearts are what somebody coming back expects to see moved.
  const listKey = `evt-photos:${slug}`;
  useEffect(() => {
    let live = true;
    try {
      const hit = JSON.parse(window.sessionStorage.getItem(listKey) || 'null');
      if (Array.isArray(hit?.data)) { setPhotos(hit.data); setHeartsReady(!!hit.heartsReady); }
    } catch { /* no cache */ }
    fetch(`/api/events/public/photos?slug=${encodeURIComponent(slug)}&v=${encodeURIComponent(visitorId())}`)
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        if (!data.success) { setError(data.message); return; }
        setPhotos(data.data || []);
        setHeartsReady(!!data.heartsReady);
        try {
          window.sessionStorage.setItem(listKey, JSON.stringify({ at: Date.now(), heartsReady: !!data.heartsReady, data: data.data || [] }));
        } catch { /* full */ }
      })
      .catch(() => live && setError('Could not load the photos. Check your connection.'));
    return () => { live = false; };
  }, [slug, listKey]);

  // A heart, given or taken back. Shown at once; the server's count replaces
  // the guess, and a refusal puts it back the way it was.
  const toggleHeart = useCallback(async (photo) => {
    const on = !photo.hearted;
    const patch = (fields) => setPhotos((list) => (list || []).map((p) => (p.id === photo.id ? { ...p, ...fields } : p)));
    patch({ hearted: on, hearts: Math.max(0, (photo.hearts || 0) + (on ? 1 : -1)) });
    setHeartError('');
    try {
      const res = await fetch('/api/events/public/photos/hearts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, photoId: photo.id, visitor: visitorId(), on }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'That heart did not go through.');
      patch({ hearted: data.hearted, hearts: data.hearts });
    } catch (e) {
      patch({ hearted: photo.hearted, hearts: photo.hearts });
      setHeartError(e.message || 'That heart did not go through. Check your connection.');
    }
  }, [slug]);

  // ---- Double-tap to heart ----
  // Like the photo apps everybody already knows: two quick taps on a photo
  // give it a heart - and the church's logo pops up on it with the heart. A
  // double tap only ever gives one; taking it back is the heart button. One
  // tap still opens the photo, a moment later, once it is clear no second
  // tap is coming.
  const [pop, setPop] = useState(null); // { id, key }
  const tapRef = useRef({ id: null, at: 0, timer: null });
  useEffect(() => () => clearTimeout(tapRef.current.timer), []);
  const loveIt = useCallback((photo) => {
    setPop({ id: photo.id, key: Date.now() });
    if (!photo.hearted) toggleHeart(photo);
  }, [toggleHeart]);
  // Where the tapped thumbnail is on the screen: the full view grows out of it.
  const [openFrom, setOpenFrom] = useState(null);
  const openAt = (index, el) => {
    const r = el?.getBoundingClientRect?.();
    setOpenFrom(r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
    setOpen(index);
  };
  const tapThumb = (photo, index, el) => {
    if (picking) { togglePick(photo.id); return; }
    if (selecting) { toggleSelect(photo.id); return; }
    if (!heartsReady) { openAt(index, el); return; }
    const t = tapRef.current;
    const now = Date.now();
    clearTimeout(t.timer);
    if (t.id === photo.id && now - t.at < 300) {
      tapRef.current = { id: null, at: 0, timer: null };
      loveIt(photo);
      return;
    }
    tapRef.current = {
      id: photo.id,
      at: now,
      timer: setTimeout(() => { tapRef.current = { id: null, at: 0, timer: null }; openAt(index, el); }, 260),
    };
  };

  if (error) return <div className="ep-empty"><i className="fas fa-triangle-exclamation"></i><p>{error}</p></div>;
  if (!photos) return <div className="ep-loading"><span className="ep-spinner" /> Loading photos…</div>;

  // ---- This page of the grid ----
  const pages = Math.max(1, Math.ceil(shown.length / PHOTOS_PER_PAGE));
  const pageNow = Math.min(page, pages);
  const first = (pageNow - 1) * PHOTOS_PER_PAGE;
  const onPage = shown.slice(first, first + PHOTOS_PER_PAGE);
  const goPage = (n) => {
    setPage(n);
    gridTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // A photo's number across the whole event, for its file name - the same
  // photo is always "photo-07", whichever day or page it was downloaded from.
  const numberOf = (p) => photos.indexOf(p) + 1;
  const pickedForDownload = selected.map((id) => photos.find((p) => p.id === id)).filter(Boolean);
  const busyMode = picking || selecting;

  return (
    <div className="ep-photos ep-id-protected" onContextMenu={block} onDragStart={block}>
      {covered && (
        <div className="ep-screen-cover" aria-hidden="true">
          <i className="fas fa-eye-slash"></i>
          <span>Photos hidden</span>
        </div>
      )}
      <ChurchBrand className="ep-photos-brand" />
      <div className="ep-photos-bar" ref={gridTopRef}>
        {picking ? (
          <p>Pick up to <strong>{STORY_MAX}</strong> photos for your story</p>
        ) : selecting ? (
          <p>Tap the photos to download <span className="ep-muted-sm">(up to {DOWNLOAD_MAX})</span></p>
        ) : (
          <p><strong>{shown.length}</strong> photo{shown.length === 1 ? '' : 's'}</p>
        )}
        <div className="ep-photos-actions">
          {busyMode ? (
            <button type="button" className="ep-link" onClick={picking ? stopPicking : stopSelecting}><i className="fas fa-times"></i> Cancel</button>
          ) : photos.length > 0 && (
            <>
              <button type="button" className="ep-btn ep-btn-sm ep-btn-ghost" onClick={() => setSelecting(true)}>
                <i className="fas fa-download"></i> Download
              </button>
              <button type="button" className="ep-btn ep-btn-sm ep-btn-story" onClick={() => setPicking(true)}>
                <i className="fas fa-wand-magic-sparkles"></i> Make a Story
              </button>
            </>
          )}
        </div>
      </div>
      {days.length > 1 && (
        <DayTabs
          days={days}
          value={day}
          onChange={(d) => { setDay(d); setPage(1); setOpen(-1); }}
          all={`${photos.length} photo${photos.length === 1 ? '' : 's'}`}
        />
      )}
      {heartsReady && !busyMode && shown.length > 0 && (
        <p className="ep-love-hint"><i className="fas fa-heart"></i> Double-tap a photo to give it a heart</p>
      )}
      {heartError && <p className="ep-error ep-heart-error"><i className="fas fa-circle-exclamation"></i> {heartError}</p>}
      {shown.length === 0 ? (
        <div className="ep-empty">
          <i className="fas fa-camera"></i>
          <h2>No photos yet</h2>
          <p>{day === 'all' ? 'Photos from the event' : `Day ${days.indexOf(day) + 1} photos`} will appear here once they are uploaded.</p>
        </div>
      ) : (
        <>
          <div className="ep-grid">
            {onPage.map((p, i) => {
              const index = first + i;
              const n = picked.indexOf(p.id);
              const ticked = selected.includes(p.id);
              return (
                <div key={p.id} className="ep-thumb-wrap">
                  <button
                    type="button"
                    className={`ep-thumb ${busyMode ? 'is-picking' : ''} ${n >= 0 || ticked ? 'is-picked' : ''} ${selecting ? 'is-selecting' : ''}`}
                    onClick={(e) => tapThumb(p, index, e.currentTarget)}
                    aria-pressed={busyMode ? (n >= 0 || ticked) : undefined}
                    aria-label={selecting ? `${ticked ? 'Unselect' : 'Select'} photo ${numberOf(p)}` : undefined}
                  >
                    {/* Fades in once it has loaded - already in the browser, at once. */}
                    <img
                      src={p.thumb}
                      alt={p.caption || `Event photo ${numberOf(p)}`}
                      loading="lazy"
                      decoding="async"
                      className="ep-fadeimg"
                      ref={(img) => { if (img?.complete) img.classList.add('is-in'); }}
                      onLoad={(e) => e.currentTarget.classList.add('is-in')}
                    />
                    {picking && <span className="ep-pick">{n >= 0 ? n + 1 : ''}</span>}
                    {selecting && <span className="ep-pick ep-tick">{ticked && <i className="fas fa-check"></i>}</span>}
                  </button>
                  {pop?.id === p.id && <LovePop key={pop.key} onDone={() => setPop(null)} />}
                  {heartsReady && !busyMode && <HeartButton photo={p} onToggle={toggleHeart} />}
                </div>
              );
            })}
          </div>
          <PhotoPager page={pageNow} pages={pages} onPage={goPage} />
          {pages > 1 && (
            <p className="ep-pager-range">
              Showing {first + 1}–{first + onPage.length} of {shown.length}
            </p>
          )}
        </>
      )}
      {picking && (
        <div className="ep-pickbar">
          <span>{picked.length} of {STORY_MAX} picked</span>
          <button
            type="button"
            className="ep-btn ep-btn-story"
            disabled={!picked.length}
            onClick={() => setStory(picked.map((id) => photos.find((p) => p.id === id)).filter(Boolean))}
          >
            <i className="fas fa-wand-magic-sparkles"></i> Create Story
          </button>
        </div>
      )}
      {selecting && (
        <div className="ep-pickbar ep-dlbar">
          <span>
            {selected.length} selected
            {selected.length >= DOWNLOAD_MAX && <em> · that is the most at once</em>}
          </span>
          <div className="ep-dlbar-acts">
            <button
              type="button"
              className="ep-link"
              onClick={() => setSelected((cur) => {
                const add = onPage.map((p) => p.id).filter((id) => !cur.includes(id));
                return [...cur, ...add].slice(0, DOWNLOAD_MAX);
              })}
            >
              <i className="fas fa-check-double"></i> Select page
            </button>
            <button
              type="button"
              className="ep-btn"
              disabled={!selected.length}
              onClick={() => setDownload({ key: Date.now(), list: pickedForDownload })}
            >
              <i className="fas fa-download"></i> Download{selected.length ? ` (${selected.length})` : ''}
            </button>
          </div>
        </div>
      )}
      {story && (
        <StoryMaker
          photos={story}
          event={event}
          slug={slug}
          name={name}
          onClose={() => setStory(null)}
          onDone={() => { setStory(null); stopPicking(); }}
        />
      )}
      {open >= 0 && shown[open] && (
        <Lightbox
          photos={shown}
          index={open}
          from={openFrom}
          onIndex={setOpen}
          // Back to the page the last photo looked at is on.
          onClose={() => { setPage(Math.floor(open / PHOTOS_PER_PAGE) + 1); setOpen(-1); }}
          onHeart={heartsReady ? toggleHeart : null}
          onDownload={(p) => setDownload({ key: Date.now(), list: [p] })}
        />
      )}
      {download && (
        <DownloadOverlay
          key={download.key}
          list={download.list}
          eventTitle={publicEventTitle(event)}
          numberOf={numberOf}
          onClose={(finished) => { setDownload(null); if (finished) stopSelecting(); }}
        />
      )}
    </div>
  );
}

// Page numbers with the far ones folded away: 1 … 4 5 6 … 10.
const pageNumbers = (page, pages) => {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  keep.forEach((n, i) => {
    if (i && n - keep[i - 1] > 1) out.push(`gap-${n}`);
    out.push(n);
  });
  return out;
};

function PhotoPager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <nav className="ep-pager" aria-label="Photo pages">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <i className="fas fa-chevron-left"></i>
      </button>
      {pageNumbers(page, pages).map((n) => (typeof n === 'string'
        ? <span key={n} className="ep-pager-gap">…</span>
        : (
          <button
            type="button"
            key={n}
            className={n === page ? 'active' : ''}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        )))}
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <i className="fas fa-chevron-right"></i>
      </button>
    </nav>
  );
}

// The church's lockup, as at the top of the dashboard sidebar: the logo, then
// JOYFUL SOUND CHURCH over a half-size, widely tracked INTERNATIONAL.
function ChurchBrand({ className = '' }) {
  return (
    <div className={`ep-brand ${className}`}>
      <img src="/assets/LOGO.png" alt="Joyful Sound Church International logo" />
      <span className="ep-brand-name">Joyful Sound Church</span>
      <span className="ep-brand-sub">International</span>
    </div>
  );
}

// The burst a double tap leaves on a photo: the church's logo with a heart,
// popping up in the middle and fading away.
function LovePop({ onDone, big = false }) {
  return (
    <span
      className={`ep-love-pop ${big ? 'is-big' : ''}`}
      aria-hidden="true"
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onDone?.(); }}
    >
      <img src="/assets/LOGO.png" alt="" />
      <i className="fas fa-heart"></i>
    </span>
  );
}

// ---- Downloading ----
// The photos come down at full size - framed, with nothing stamped over the
// middle (see DOWNLOAD_T in lib/eventPhotos) - three at a
// time, with real progress. While they do, the church's logo sits in the
// middle of the screen and Bible fun facts pop up one after another: a fresh
// batch from the church's AI, with checked ones standing in until it answers.
//
// How they are saved depends on the device:
//   a phone     the share sheet ("Save N images" puts them in the gallery)
//   a computer  one photo as a .jpg, several as one .zip
const slugName = (title) => String(title || 'event').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'event';

const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const canShareFiles = (files) => {
  try { return isPhone() && !!navigator.canShare?.({ files }); } catch { return false; }
};

function DownloadOverlay({ list, eventTitle, numberOf, onClose }) {
  const [phase, setPhase] = useState('loading'); // loading | ready | done | error
  const [progress, setProgress] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [failed, setFailed] = useState(0);
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState('');
  const [facts, setFacts] = useState(fallbackFacts);
  const [factAt, setFactAt] = useState(0);
  const ctrlRef = useRef(null);
  const total = list.length;
  const base = slugName(eventTitle);

  // A new fact every few seconds; the AI's batch takes over when it lands.
  useEffect(() => {
    let live = true;
    loadBibleFacts().then((ai) => { if (live && ai.length) { setFacts(ai); setFactAt(0); } });
    const id = setInterval(() => setFactAt((i) => i + 1), 5500);
    return () => { live = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const save = async (got) => {
    if (got.length === 1) { saveBlob(got[0], got[0].name); return; }
    const parts = await Promise.all(got.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    saveBlob(makeZip(parts), `${base}-photos.zip`);
  };

  useEffect(() => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const frac = new Array(total).fill(0);
    const tick = () => setProgress(frac.reduce((s, f) => s + f, 0) / total);
    const results = new Array(total).fill(null);

    // One photo, with its bytes counted as they arrive when the size is known.
    const fetchOne = async (p, i) => {
      const res = await fetch(p.download || p.full, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const size = Number(res.headers.get('content-length')) || 0;
      let blob;
      if (res.body && size) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          frac[i] = Math.min(0.99, got / size);
          tick();
        }
        blob = new Blob(chunks, { type: res.headers.get('content-type') || 'image/jpeg' });
      } else {
        blob = await res.blob();
      }
      const n = String(numberOf(p)).padStart(2, '0');
      return new File([blob], `${base}-photo-${n}.jpg`, { type: blob.type || 'image/jpeg' });
    };

    let next = 0;
    const worker = async () => {
      while (next < total) {
        const i = next;
        next += 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          results[i] = await fetchOne(list[i], i);
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          results[i] = null;
        }
        frac[i] = 1;
        tick();
        setDoneCount((c) => c + 1);
      }
    };

    (async () => {
      try {
        await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
      } catch {
        return; // cancelled
      }
      const got = results.filter(Boolean);
      setFailed(total - got.length);
      if (!got.length) {
        setPhase('error');
        setMessage('The photos could not be downloaded. Check your connection and try again.');
        return;
      }
      setFiles(got);
      if (canShareFiles(got)) { setPhase('ready'); return; }
      try {
        await save(got);
        setPhase('done');
      } catch {
        setPhase('error');
        setMessage('The download could not be saved. Try fewer photos at once.');
      }
    })();
    return () => ctrl.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The share sheet needs a fresh tap, so it is a button rather than automatic.
  const shareNow = async () => {
    try {
      await navigator.share({ files, title: eventTitle });
      setPhase('done');
    } catch (e) {
      if (e?.name !== 'AbortError') setMessage('Sharing did not work on this phone - use "Download file" instead.');
    }
  };
  const asFile = async () => {
    try { await save(files); setPhase('done'); } catch { setMessage('The download could not be saved.'); }
  };

  const pct = Math.round(progress * 100);
  const fact = facts.length ? facts[factAt % facts.length] : '';
  const what = total === 1 ? 'your photo' : `${total} photos`;

  return (
    <div className="ep-dl-overlay" role="dialog" aria-modal="true" aria-label="Downloading photos">
      <div className="ep-dl">
        <ChurchBrand className="ep-dl-brand" />

        {phase === 'loading' && (
          <>
            <p className="ep-dl-status">
              {total === 1 ? 'Getting your photo ready…' : `Downloading ${Math.min(doneCount + 1, total)} of ${total} photos…`}
            </p>
            <div className="ep-dl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
            <p className="ep-dl-pct">{pct}%</p>
          </>
        )}
        {phase === 'ready' && (
          <>
            <p className="ep-dl-status is-ok"><i className="fas fa-circle-check"></i> {total === 1 ? 'Your photo is ready' : `Your ${files.length} photos are ready`}</p>
            <div className="ep-dl-acts">
              <button type="button" className="ep-btn" onClick={shareNow}>
                <i className="fas fa-mobile-screen"></i> Save to your phone
              </button>
              <button type="button" className="ep-link" onClick={asFile}><i className="fas fa-file-arrow-down"></i> Download file instead</button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <p className="ep-dl-status is-ok">
            <i className="fas fa-circle-check"></i> Saved {what === 'your photo' ? 'your photo' : `${files.length} photos`}!
            <small>{files.length > 1 && !canShareFiles(files) ? 'They are in one .zip file in your Downloads.' : 'Check your downloads or gallery.'}</small>
          </p>
        )}
        {phase === 'error' && <p className="ep-dl-status is-bad"><i className="fas fa-circle-exclamation"></i> {message}</p>}
        {phase !== 'error' && message && <p className="ep-dl-note">{message}</p>}
        {phase !== 'loading' && failed > 0 && phase !== 'error' && (
          <p className="ep-dl-note">{failed} photo{failed === 1 ? '' : 's'} could not be downloaded.</p>
        )}

        {fact && (phase === 'loading' || phase === 'ready') && (
          <div className="ep-fact" key={`${factAt}-${fact.length}`}>
            <span className="ep-fact-label"><i className="fas fa-lightbulb"></i> Did you know?</span>
            <p>{fact}</p>
          </div>
        )}

        <div className="ep-dl-foot">
          {phase === 'loading' ? (
            <button type="button" className="ep-link" onClick={() => { ctrlRef.current?.abort(); onClose(false); }}>
              <i className="fas fa-times"></i> Cancel
            </button>
          ) : (
            <button type="button" className="ep-btn ep-btn-ghost" onClick={() => onClose(phase === 'done')}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

// The heart on a photo: anyone can give one, no login, and everyone sees how
// many it has. Its own button beside the photo's (never inside it), so a tap
// on the heart does not open the photo.
function HeartButton({ photo, onToggle, big = false }) {
  const [pop, setPop] = useState(false);
  const count = photo.hearts || 0;
  return (
    <button
      type="button"
      className={`ep-heart ${photo.hearted ? 'on' : ''} ${big ? 'is-big' : ''} ${pop ? 'pop' : ''}`}
      aria-pressed={!!photo.hearted}
      aria-label={photo.hearted ? `Take your heart back - ${count} ${count === 1 ? 'heart' : 'hearts'}` : `Heart this photo - ${count} ${count === 1 ? 'heart' : 'hearts'}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!photo.hearted) { setPop(true); setTimeout(() => setPop(false), 450); }
        onToggle(photo);
      }}
    >
      <i className={`${photo.hearted ? 'fas' : 'far'} fa-heart`}></i>
      <span>{count}</span>
    </button>
  );
}

// A pop-up over the page: Enter Credentials, and Feedback. Escape or a tap
// outside closes it, and the page behind does not scroll meanwhile.
function Modal({ onClose, label, children }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, []);
  return (
    <div className="ep-popup-overlay ep-modal-overlay" onClick={onClose}>
      <div className="ep-modal" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ep-modal-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        {children}
      </div>
    </div>
  );
}

// Feedback, once the event is over. A name, or "Make anonymous" - which
// sends no name at all - and up to FEEDBACK_MAX_WORDS words, counted as they
// are typed the same way the server counts them.
function FeedbackForm({ slug, eventTitle, defaultName = '', onClose }) {
  const [name, setName] = useState(defaultName);
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const words = countWords(message);
  const tooLong = words > FEEDBACK_MAX_WORDS;
  const canSend = !busy && words > 0 && !tooLong && (anonymous || !!name.trim());

  const submit = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/events/public/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: anonymous ? '' : name.trim(), anonymous, message }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || 'Your feedback could not be sent.'); return; }
      setSent(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="ep-feedback ep-feedback-done">
        <div className="ep-lock-icon"><i className="fas fa-heart"></i></div>
        <h2>Thank you!</h2>
        <p className="ep-lock-sub">
          Your feedback was sent{anonymous ? ' anonymously' : ''}. It helps us make the next gathering even better.
        </p>
        <button type="button" className="ep-btn" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <form className="ep-feedback" onSubmit={submit}>
      <div className="ep-lock-icon"><i className="fas fa-comment-dots"></i></div>
      <h2>Give Feedback</h2>
      <p className="ep-lock-sub">How was {eventTitle}? Tell us what blessed you, and what we can do better.</p>
      <div className="ep-form">
        <label htmlFor="ep-fb-name">Your name</label>
        <div className="ep-fb-name">
          <input
            id="ep-fb-name"
            value={anonymous ? '' : name}
            onChange={(e) => setName(e.target.value)}
            placeholder={anonymous ? 'Anonymous' : 'e.g. Juan Dela Cruz'}
            maxLength={FEEDBACK_MAX_NAME}
            autoComplete="name"
            disabled={anonymous || busy}
          />
          <button
            type="button"
            className={`ep-anon ${anonymous ? 'on' : ''}`}
            aria-pressed={anonymous}
            onClick={() => setAnonymous((v) => !v)}
            disabled={busy}
          >
            <i className={`fas ${anonymous ? 'fa-user-secret' : 'fa-mask'}`}></i>
            {anonymous ? 'Anonymous' : 'Make anonymous'}
          </button>
        </div>
        {anonymous && <p className="ep-hint">Your name will not be sent or saved.</p>}

        <label htmlFor="ep-fb-msg">Your feedback</label>
        <textarea
          id="ep-fb-msg"
          rows={7}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Share your thoughts about the event…"
          disabled={busy}
        />
        <p className={`ep-hint ep-fb-count ${tooLong ? 'warn' : ''}`}>
          <b>{words}</b> / {FEEDBACK_MAX_WORDS} words{tooLong ? ' - please shorten it a little' : ''}
        </p>

        <button type="submit" className="ep-btn" disabled={!canSend}>
          {busy ? <span className="ep-spinner" /> : <i className="fas fa-paper-plane"></i>} Submit Feedback
        </button>
      </div>
      {error && <p className="ep-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}
    </form>
  );
}

function Unlock({
  slug, code, year, onUnlocked,
  icon = 'fa-user-lock', title = 'Enter Credentials',
  sub = 'For attendees only. Sign in with your password or your RFID card.',
  cta = 'Sign In',
}) {
  const [mode, setMode] = useState('password');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sameLast, setSameLast] = useState(false);
  const [nfcState, setNfcState] = useState('');
  const cardRef = useRef(null);
  const [cardBuf, setCardBuf] = useState('');
  // On a phone the card is read by the phone itself, over NFC - there is no
  // desk reader to tap it on - so the tab says NFC and asks for the phone's
  // NFC instead of waiting for a USB reader that is not there.
  const [isPhone, setIsPhone] = useState(false);
  const [noNfcPopup, setNoNfcPopup] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);
  const nfcCtrlRef = useRef(null);

  const hasNfc = typeof window !== 'undefined' && 'NDEFReader' in window;
  useEffect(() => {
    const ua = navigator.userAgent || '';
    setIsPhone(/Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      // iPadOS reports itself as a Mac; the touch screen gives it away.
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));
  }, []);
  // A scan left running would keep the phone listening after the attendee
  // switched to the password, or left the page.
  const stopNfc = useCallback(() => {
    nfcCtrlRef.current?.abort();
    nfcCtrlRef.current = null;
    setNfcScanning(false);
    setNfcState('');
  }, []);
  useEffect(() => stopNfc, [stopNfc]);
  const lowercase = password !== password.toUpperCase();

  const submit = useCallback(async (payload) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/events/public/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, code: code || undefined, ...payload }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.sameLastName) setSameLast(true);
        setError(data.message || 'Could not sign you in.');
        return;
      }
      onUnlocked(data);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }, [slug, code, onUnlocked]);

  // A USB reader (the 13.56 MHz desk reader, or any other that acts as a
  // keyboard) types the card number and presses Enter. The hidden box gets
  // the caret, and the whole page listens too, so a tap still counts when the
  // box has lost focus. Keys under 120 ms apart are the reader; a person
  // typing is slower, and their keys are not collected.
  const sendRef = useRef(null);
  useEffect(() => {
    if (mode !== 'rfid' || isPhone) return undefined;
    // preventScroll: focusing the hidden box must never move the page.
    setTimeout(() => cardRef.current?.focus({ preventScroll: true }), 50);
    // Judged over the whole tap (lib/rfid wedgeCapture), so one stall in the
    // middle of it cannot throw away the digits typed before the stall.
    const key = { buf: '', at: 0, gaps: [] };
    const onKeyDown = (e) => {
      if (e.target === cardRef.current) return; // the box handles its own
      const now = Date.now();
      if (now - key.at > WEDGE_IDLE_RESET_MS) { key.buf = ''; key.gaps = []; }
      else if (key.buf || e.key === 'Enter') key.gaps.push(now - key.at);
      key.at = now;
      if (e.key === 'Enter') {
        const captured = wedgeCapture(key.buf, key.gaps);
        key.buf = '';
        key.gaps = [];
        if (captured) { e.preventDefault(); sendRef.current?.(captured); }
        return;
      }
      if (e.key.length === 1) key.buf += e.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, isPhone]);

  const sendCard = (raw) => {
    const uid = normalizeUid(raw);
    setCardBuf('');
    if (!isPlausibleUid(uid)) { setError('That card could not be read. Please tap it again.'); return; }
    submit({ uid });
  };
  sendRef.current = sendCard;

  // Android Chrome can read the card on the phone itself. reader.scan() is
  // what makes the browser ask for NFC permission, so it has to run from the
  // attendee's own tap - the NFC tab, or the Turn on NFC button.
  const scanWithPhone = async () => {
    setError('');
    // iPhones, and browsers other than Chrome on Android, cannot read a card
    // from a web page at all. Saying so plainly beats a button that does nothing.
    if (!hasNfc) { setNoNfcPopup(true); return; }
    stopNfc();
    try {
      // eslint-disable-next-line no-undef
      const reader = new NDEFReader();
      const ctrl = new AbortController();
      nfcCtrlRef.current = ctrl;
      await reader.scan({ signal: ctrl.signal });
      setNfcScanning(true);
      setNfcState('Hold your ID card against the back of your phone…');
      reader.onreading = (e) => {
        stopNfc();
        sendCard(e.serialNumber || '');
      };
      reader.onreadingerror = () => setError('The card could not be read. Try holding it still.');
    } catch (e) {
      stopNfc();
      if (e?.name === 'AbortError') return;
      // Chrome on Android without an NFC chip.
      if (e?.name === 'NotSupportedError') { setNoNfcPopup(true); return; }
      setError(e?.name === 'NotAllowedError'
        ? 'NFC permission was not given. Tap "Turn on NFC" again and choose Allow, or allow NFC for this site in your browser settings.'
        : e?.name === 'NotReadableError'
          ? 'NFC is turned off. Turn on NFC in your phone settings, then tap "Turn on NFC" again.'
          : 'NFC could not be started on this phone. Use your password instead.');
    }
  };

  return (
    <div className="ep-lock">
      <div className="ep-lock-icon"><i className={`fas ${icon}`}></i></div>
      <h2>{title}</h2>
      <p className="ep-lock-sub">{sub}</p>

      <div className="ep-seg" role="tablist">
        <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => { stopNfc(); setMode('password'); setError(''); }}>
          <i className="fas fa-key"></i> Password
        </button>
        <button
          type="button"
          className={mode === 'rfid' ? 'active' : ''}
          onClick={() => {
            setMode('rfid');
            setError('');
            // On a phone, choosing NFC is the tap that asks for permission.
            if (isPhone && !nfcScanning) scanWithPhone();
          }}
        >
          {isPhone
            ? <><i className="fas fa-wifi ep-nfc-ico"></i> NFC</>
            : <><i className="fas fa-id-card"></i> RFID Card</>}
        </button>
      </div>

      {mode === 'password' ? (
        <form className="ep-form" onSubmit={(e) => { e.preventDefault(); submit({ password }); }}>
          <label htmlFor="ep-pw">Password</label>
          <input
            id="ep-pw"
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={sameLast ? `JUANDELACRUZ@${year}` : `LASTNAME@${year}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <p className={`ep-hint ${lowercase ? 'warn' : ''}`}>
            {lowercase
              ? <><i className="fas fa-triangle-exclamation"></i> Use ALL CAPITAL letters.</>
              : sameLast
                ? <>Same last name as another attendee: type the <b>first 4 letters</b> of your first name (all of it if it is shorter), then your last name, then <b>@{year}</b> — e.g. Juan Dela Cruz: <b>JUANDELACRUZ@{year}</b></>
                : <>Your last name in CAPITAL letters, then <b>@{year}</b> — e.g. Juan Dela Cruz: <b>DELACRUZ@{year}</b></>}
          </p>
          <button type="submit" className="ep-btn" disabled={busy || !password.trim()}>
            {busy ? <span className="ep-spinner" /> : <i className="fas fa-unlock"></i>} {cta}
          </button>
        </form>
      ) : (
        <div className="ep-form">
          {isPhone ? (
            <>
              <div
                className={`ep-tap ${busy ? 'busy' : ''} ${nfcScanning ? '' : 'idle'}`}
                onClick={() => { if (!nfcScanning && !busy) scanWithPhone(); }}
              >
                <i className="fas fa-wifi"></i>
                <strong>
                  {busy ? 'Checking your card…' : nfcScanning ? 'Hold your ID card to your phone' : 'NFC is off'}
                </strong>
                <span>
                  {nfcScanning
                    ? (nfcState || 'Touch the card to the back of your phone and keep it still.')
                    : 'Turn on NFC so your phone can read your ID card.'}
                </span>
              </div>
              {!nfcScanning && (
                <button type="button" className="ep-btn" onClick={scanWithPhone} disabled={busy}>
                  <i className="fas fa-wifi ep-nfc-ico"></i> Turn on NFC
                </button>
              )}
            </>
          ) : (
            <>
              <div className={`ep-tap ${busy ? 'busy' : ''}`} onClick={() => cardRef.current?.focus({ preventScroll: true })}>
                <i className="fas fa-wifi"></i>
                <strong>{busy ? 'Checking your card…' : 'Tap your ID card on the reader'}</strong>
                <span>Keep this page open while you tap.</span>
              </div>
              {/* Where a USB reader "types" the card number. */}
              <input
                ref={cardRef}
                className="ep-card-input"
                inputMode="none"
                autoComplete="off"
                aria-label="RFID card number"
                value={cardBuf}
                onChange={(e) => setCardBuf(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendCard(cardBuf); } }}
                disabled={busy}
              />
            </>
          )}
        </div>
      )}

      {error && <p className="ep-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}

      {noNfcPopup && (
        <div className="ep-popup-overlay" onClick={() => setNoNfcPopup(false)}>
          <div className="ep-popup" role="alertdialog" aria-modal="true" aria-labelledby="ep-nonfc-title" onClick={(e) => e.stopPropagation()}>
            <div className="ep-popup-icon"><i className="fas fa-mobile-screen"></i></div>
            <h3 id="ep-nonfc-title">Your phone doesn&apos;t have NFC</h3>
            <p>
              This phone or browser can&apos;t read your ID card. iPhones can&apos;t read cards from a
              web page. On Android, open this page in <b>Chrome</b>.
            </p>
            <p>You can still unlock with your <b>password</b>.</p>
            <div className="ep-popup-acts">
              <button type="button" className="ep-btn" onClick={() => { setNoNfcPopup(false); stopNfc(); setMode('password'); setError(''); }}>
                <i className="fas fa-key"></i> Use Password
              </button>
              <button type="button" className="ep-btn ep-btn-ghost" onClick={() => setNoNfcPopup(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Profile - the attendee's virtual ID, the same card the desk prints
// (lib/idCard.js). Tap or swipe and it turns over, always left to right.
// View only: it cannot be saved from here.
// ============================================================

// The site the QR on the back points at - the same as the printed ID.
const siteOrigin = () => (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/+$/, '');

// Drawn at 4x and shown at up to 320px wide: crisp on high-density phones.
const ID_PREVIEW_SCALE = 4;

// ============================================================
// Extras - what the attendee availed on top of their registration, and, if
// one of those is accommodation, where they are sleeping and with whom.
// ============================================================
const OCC_ICON = { boys: 'fa-person', girls: 'fa-person-dress', family: 'fa-people-roof' };

function Extras({ info }) {
  if (!info) {
    return <div className="ep-extras"><p className="ep-muted-center"><span className="ep-spinner" /> Loading your extras…</p></div>;
  }
  if (info.error) {
    return <div className="ep-extras"><p className="ep-error"><i className="fas fa-circle-exclamation"></i> {info.error}</p></div>;
  }
  const { extras, accommodation: acc } = info;
  const room = acc?.room;

  return (
    <div className="ep-extras">
      <div className="ep-extras-head">
        <h2><i className="fas fa-gift"></i> Your Extras</h2>
        <p>What you availed on top of your registration.</p>
      </div>

      <ul className="ep-extra-list">
        {extras.map((x, i) => (
          <li key={`${x.name}-${i}`}>
            <i className="fas fa-circle-check"></i>
            <span>{x.name}</span>
            {x.fee > 0 && <em>₱{x.fee.toLocaleString('en-PH')}</em>}
          </li>
        ))}
      </ul>

      {acc && (
        <div className="ep-stay">
          <div className="ep-stay-head">
            <i className="fas fa-hotel"></i>
            <div>
              <span className="ep-stay-label">Accommodation</span>
              <b>{acc.hotel || 'The event venue'}</b>
              {acc.address && <span className="ep-stay-addr"><i className="fas fa-location-dot"></i> {acc.address}</span>}
            </div>
          </div>

          {!room ? (
            <div className="ep-stay-wait">
              <i className="fas fa-hourglass-half"></i>
              <div>
                <b>Your room is not assigned yet</b>
                <span>The registration desk will give you a room when you check in. Come back to this page after.</span>
              </div>
            </div>
          ) : (
            <>
              <div className="ep-room">
                <div className="ep-room-num">
                  <span>Room</span>
                  <b>{room.number}</b>
                </div>
                <div className="ep-room-info">
                  <b>{room.type}</b>
                  {room.pax && <span><i className="fas fa-user-group"></i> Good for {room.pax} pax</span>}
                  {room.occupancyLabel && (
                    <span className={`ep-occ ${room.occupancy}`}>
                      <i className={`fas ${OCC_ICON[room.occupancy] || 'fa-users'}`}></i> {room.occupancyLabel}
                    </span>
                  )}
                </div>
              </div>

              <div className="ep-stay-section">
                <span className="ep-stay-label">Beds</span>
                {room.beds.length > 0 ? (
                  <ul className="ep-beds">
                    {room.beds.map((b) => (
                      <li key={b.type}><i className="fas fa-bed"></i> {b.count} × {b.type}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ep-stay-none">{room.bedsText || 'No bed details given for this room.'}</p>
                )}
              </div>

              <div className="ep-stay-section">
                <span className="ep-stay-label">Who is with you</span>
                {acc.roommates.length === 0 ? (
                  <p className="ep-stay-none">Nobody else in this room yet.</p>
                ) : (
                  <ul className="ep-mates">
                    {acc.roommates.map((m, i) => (
                      <li key={`${m.name}-${i}`}>
                        <span className="ep-mate-av">{m.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                        <span className="ep-mate-name">{m.name}</span>
                        {m.sameGroup && <em>Your group</em>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Profile({ slug, code, year, onName, onLock }) {
  const passKey = `evt-pass:${slug}`;
  const [pass, setPass] = useState(null); // null until the browser has been asked
  const [names, setNames] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { setPass(store.get(passKey) || ''); }, [passKey]);

  useEffect(() => {
    if (!pass) { setNames(null); return undefined; }
    let live = true;
    setError('');
    fetch(`/api/events/public/profile?slug=${encodeURIComponent(slug)}`, { headers: { 'x-event-pass': pass } })
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        if (data.locked) { store.del(passKey); setPass(''); onLock(); return; }
        if (!data.success) { setError(data.message || 'Could not load your ID.'); return; }
        setNames({ firstName: data.firstName, lastName: data.lastName });
      })
      .catch(() => live && setError('Could not load your ID. Check your connection.'));
    return () => { live = false; };
  }, [pass, slug, passKey, onLock]);

  const unlocked = (result) => {
    store.set(passKey, result.pass);
    onName(result.name || '', result.code || '');
    setPass(result.pass);
  };

  // Locks the photos too: it is one unlock for both.
  const lock = () => {
    onLock();
    store.del(passKey);
    try { window.sessionStorage.removeItem(`evt-photos:${slug}`); } catch { /* ignore */ }
    setPass('');
  };

  if (pass === null) return <div className="ep-loading"><span className="ep-spinner" /> Loading…</div>;
  if (!pass) {
    return (
      <Unlock
        slug={slug} code={code} year={year} onUnlocked={unlocked}
        icon="fa-id-badge" title="Your Virtual ID"
        sub="Unlock with your password or your RFID card to see your ID."
        cta="Show My ID"
      />
    );
  }
  if (error) return <div className="ep-empty"><i className="fas fa-triangle-exclamation"></i><p>{error}</p></div>;
  if (!names) return <div className="ep-loading"><span className="ep-spinner" /> Loading your ID…</div>;

  return <VirtualId slug={slug} names={names} onLock={lock} />;
}

// A web page cannot stop the phone's own screenshot buttons. What it can do:
// no saving the card or photos (no long-press / right-click / drag), nothing
// to print, and them covered whenever the page is not in front - the app switcher,
// a snipping tool taking focus, Print Screen - so those catch a blank screen.
function useScreenGuard() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let timer = null;
    let until = 0; // a longer cover already running is never cut short
    const cover = (ms) => {
      setHidden(true);
      if (!ms) { clearTimeout(timer); until = Infinity; return; }
      const end = Date.now() + ms;
      if (until !== Infinity && end <= until) return;
      clearTimeout(timer);
      until = end;
      timer = setTimeout(() => { until = 0; setHidden(false); }, ms);
    };
    const show = () => { clearTimeout(timer); until = 0; setHidden(false); };
    const isMeta = (e) => e.key === 'Meta' || e.key === 'OS';
    const onVisibility = () => (document.hidden ? cover() : show());
    const onBlur = () => cover();
    const onFocus = () => show();
    const onKeyDown = (e) => {
      // The Windows / Cmd key comes first in Win+Shift+S and Cmd+Shift+3/4/5,
      // so everything is covered while it is held - before the tool opens.
      if (isMeta(e)) { cover(); return; }
      if (e.metaKey && e.shiftKey) { cover(4000); return; }
      if (e.key === 'PrintScreen') snapped();
    };
    const onKeyUp = (e) => {
      if (isMeta(e)) { until = 0; cover(900); return; }
      if (e.key === 'PrintScreen') snapped();
    };
    // Windows only reports Print Screen as it is let go: cover, and replace
    // what it put on the clipboard, where the browser allows it.
    const snapped = () => {
      cover(1500);
      navigator.clipboard?.writeText?.('').catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
  return hidden;
}

function VirtualId({ slug, names, onLock }) {
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const liftRef = useRef(null);
  const touch = useRef(null);
  const [ready, setReady] = useState(false);
  const [turns, setTurns] = useState(0);
  const [error, setError] = useState('');
  const covered = useScreenGuard();
  const qrText = useMemo(() => idQrText({ origin: siteOrigin(), eventSlug: slug }), [slug]);
  const showingBack = turns % 2 === 1;

  useEffect(() => {
    let live = true;
    setReady(false);
    Promise.all([
      drawIdFront(frontRef.current, names, ID_PREVIEW_SCALE),
      drawIdBack(backRef.current, { qrText, logo: true }, ID_PREVIEW_SCALE),
    ])
      .then(() => live && setReady(true))
      .catch((e) => live && setError(e.message || 'Could not draw your ID.'));
    return () => { live = false; };
  }, [names, qrText]);

  // Every turn goes the same way - the left edge swings over to the right -
  // and the card lifts off the page while it turns.
  const flip = () => {
    setTurns((t) => t + 1);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    liftRef.current?.animate?.(
      [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-10px) scale(1.05)', offset: 0.45 },
        { transform: 'translateY(0) scale(1)' },
      ],
      { duration: 850, easing: 'ease-in-out' },
    );
  };

  // A sideways swipe turns it as well; a tap is the card's own click.
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); flip(); }
  };

  const block = (e) => e.preventDefault();

  return (
    <div className="ep-profile ep-id-protected" onContextMenu={block} onDragStart={block}>
      <div className="ep-photos-bar">
        <p><strong>Your Virtual ID</strong></p>
        <button type="button" className="ep-link" onClick={onLock}><i className="fas fa-lock"></i> Lock</button>
      </div>

      <div className="ep-id-stage">
        <div className="ep-id-lift" ref={liftRef}>
          <div
            role="button"
            tabIndex={0}
            className={`ep-id-card ${covered ? 'is-covered' : ''}`}
            style={{ '--ep-id-turn': `${turns * 180}deg` }}
            onClick={flip}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            aria-label={showingBack ? 'ID back with QR code. Tap to see the front.' : 'ID front. Tap to see the back.'}
          >
            <span className="ep-id-face ep-id-front"><canvas ref={frontRef} /></span>
            <span className="ep-id-face ep-id-back"><canvas ref={backRef} /></span>
            {!ready && !error && <span className="ep-id-wait"><span className="ep-spinner" /></span>}
          </div>
          {covered && (
            <div className="ep-id-cover" aria-hidden="true">
              <i className="fas fa-eye-slash"></i>
              <span>ID hidden</span>
            </div>
          )}
        </div>
        <div className="ep-id-shadow" aria-hidden="true" />
      </div>

      <div className="ep-id-dots" aria-hidden="true">
        <span className={showingBack ? '' : 'active'} />
        <span className={showingBack ? 'active' : ''} />
      </div>
      <p className="ep-id-hint"><i className="fas fa-hand-pointer"></i> Tap or swipe the card to see the {showingBack ? 'front' : 'back'}</p>

      <div className="ep-id-actions">
        <button type="button" className="ep-btn ep-btn-ghost" onClick={flip}>
          <i className="fas fa-rotate"></i> Flip
        </button>
      </div>
      {error && <p className="ep-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}
    </div>
  );
}

// Loaded once per page: a photo seen before opens from the browser's memory.
const preloaded = new Set();
const preload = (url) => {
  if (!url || preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
};

// ============================================================
// Story maker - the picked photos as one 9:16 image for an Instagram or
// Facebook story, in the ID's red and white (see lib/storyCard.js).
// ============================================================

// Each photo cut to a slot is fetched once per visit, whatever the theme.
const storyImages = new Map();
const storyImage = (src) => {
  if (!src) return Promise.resolve(null);
  if (!storyImages.has(src)) storyImages.set(src, loadStoryImage(src).catch(() => { storyImages.delete(src); return null; }));
  return storyImages.get(src);
};

function StoryMaker({ photos, event, slug, name, onClose, onDone }) {
  const canvasRef = useRef(null);
  const [order, setOrder] = useState(photos);
  const themes = storyThemes(event);
  // The conference artwork is only fetched for the event it belongs to.
  const hasArt = themes !== STORY_THEMES;
  const [theme, setTheme] = useState(themes[0].key);
  const layouts = storyLayouts(photos.length, theme);
  const [layout, setLayout] = useState(layouts[0].key);
  const [showName, setShowName] = useState(!!name);
  const [assets, setAssets] = useState(null); // { logo, art, byId: { [photoId]: img } }
  // Where each photo sits in its box, by photo id - so it keeps its place
  // when the photos swap boxes or the layout changes.
  const [pos, setPos] = useState({});
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // Background: the theme's own ('design'), or the hero video ('video'),
  // which makes the saved story a video.
  const [bg, setBg] = useState('design');
  const [videoReady, setVideoReady] = useState(false);
  const [recorded, setRecorded] = useState(null); // the last video made, until something changes
  const [progress, setProgress] = useState(0);
  const videoRef = useRef(null);
  const recordingRef = useRef(false);
  const canVideo = typeof window !== 'undefined' && canRecordStory();
  // Music, Instagram-style: a part of a Song Playlist song (StoryMusic.jsx).
  // With music the story is saved as a video as long as that part.
  const [music, setMusic] = useState(null); // { song, buffer, peaks, cover, start, duration }
  const [pickingMusic, setPickingMusic] = useState(false);
  const [audioCtx, setAudioCtx] = useState(null);
  const preview = useSegmentPreview(audioCtx);
  // Made on the tap that opens the music, so the browser lets it play.
  const openMusic = () => {
    if (!audioCtx) setAudioCtx(makeAudioContext());
    else if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    preview.stop();
    setPickingMusic(true);
  };
  useEffect(() => () => { audioCtx?.close?.().catch(() => {}); }, [audioCtx]);
  const musicRef = useRef(null);
  musicRef.current = music ? { title: music.song.title, artist: music.song.artist, cover: music.cover } : null;
  // The story as drawn everywhere - preview, photo, video - with the music
  // sticker on top when there is music.
  const paint = (canvas, opts) => {
    drawStory(canvas, opts);
    if (musicRef.current) drawMusicSticker(canvas.getContext('2d'), musicRef.current);
  };
  const isVideo = bg === 'video' || !!music;

  useEffect(() => {
    let live = true;
    Promise.all([
      loadStoryFonts(),
      storyImage(STORY_LOGO_SRC),
      Promise.all(photos.map((p) => storyImage(storyPhotoUrl(p)))),
      hasArt ? loadStoryArt() : null,
    ]).then(([, logo, images, art]) => {
      if (!live) return;
      if (images.every((img) => !img)) setError('Could not load the photos. Check your connection and try again.');
      setAssets({ logo, art, byId: Object.fromEntries(photos.map((p, i) => [p.id, images[i]])) });
    });
    return () => { live = false; };
  }, [photos, hasArt]);

  const slots = storySlots(order.length, layout, theme);
  const images = assets ? order.map((p) => assets.byId[p.id] || null) : [];
  const positions = order.map((p) => pos[p.id] || STORY_POS);
  const video = bg === 'video' && videoReady ? videoRef.current : null;
  const drawOpts = (ring) => ({
    images, logo: assets?.logo, art: assets?.art, video, theme, event, layout, positions, active: ring, name: showName ? name : '',
  });

  // Redrawn at most once a frame, however fast a finger moves.
  const frame = useRef(0);
  const latest = useRef(null);
  latest.current = drawOpts(active);
  useEffect(() => {
    if (!assets || !canvasRef.current) return undefined;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (canvasRef.current && !recordingRef.current) paint(canvasRef.current, latest.current);
    });
    return () => cancelAnimationFrame(frame.current);
  });

  // The video background: loaded when chosen, muted and looping in the preview.
  useEffect(() => {
    if (bg !== 'video') return undefined;
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    const onReady = () => setVideoReady(true);
    const onError = () => {
      setError('Could not load the video background. Check your connection and try again.');
      setBg('design');
    };
    v.addEventListener('loadeddata', onReady);
    v.addEventListener('error', onError);
    v.src = STORY_VIDEO_SRC;
    videoRef.current = v;
    v.play().catch(() => {});
    return () => {
      v.removeEventListener('loadeddata', onReady);
      v.removeEventListener('error', onError);
      v.pause();
      v.removeAttribute('src');
      v.load();
      videoRef.current = null;
      setVideoReady(false);
    };
  }, [bg]);

  // While the video plays, the preview is redrawn every frame.
  useEffect(() => {
    if (!assets || !video) return undefined;
    let id = 0;
    const loop = () => {
      if (canvasRef.current && !recordingRef.current) paint(canvasRef.current, latest.current);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [assets, video]);

  // A video made earlier no longer matches once anything on the story changes.
  useEffect(() => { setRecorded(null); }, [bg, theme, layout, order, pos, showName, music]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  // ---- Moving a photo: drag with a finger or the mouse, pinch or scroll to zoom ----
  const now = useRef({});
  now.current = { slots, images, order };
  const pointers = useRef(new Map());
  const drag = useRef(null);
  const toStory = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * STORY_W, y: ((e.clientY - r.top) / r.height) * STORY_H };
  };
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const update = (i, fn) => {
    const id = now.current.order[i]?.id;
    if (id) setPos((cur) => ({ ...cur, [id]: fn(cur[id] || STORY_POS) }));
  };

  const onPointerDown = (e) => {
    if (!assets) return;
    const pt = toStory(e);
    pointers.current.set(e.pointerId, pt);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 1) {
      const i = storySlotAt(now.current.slots, pt.x, pt.y);
      setActive(i);
      drag.current = i >= 0 ? { i, last: pt } : null;
    } else if (pointers.current.size === 2 && drag.current) {
      const id = now.current.order[drag.current.i]?.id;
      drag.current.pinch = { d: spread(), z: (pos[id] || STORY_POS).z };
    }
  };
  const onPointerMove = (e) => {
    if (!drag.current || !pointers.current.has(e.pointerId)) return;
    const pt = toStory(e);
    pointers.current.set(e.pointerId, pt);
    const { i, pinch, last } = drag.current;
    if (pinch && pointers.current.size >= 2) {
      const z = pinch.z * (spread() / pinch.d);
      update(i, (p) => storyZoom(p, z));
      return;
    }
    drag.current.last = pt;
    const { slots: s, images: imgs } = now.current;
    update(i, (p) => storyPan(s[i], imgs[i], p, pt.x - last.x, pt.y - last.y));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (!drag.current) return;
    if (pointers.current.size === 0) drag.current = null;
    else {
      drag.current.pinch = null;
      drag.current.last = [...pointers.current.values()][0];
    }
  };
  // Scroll to zoom the photo under the mouse. Not passive, so the panel
  // does not scroll at the same time.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => {
      const r = c.getBoundingClientRect();
      const i = storySlotAt(now.current.slots, ((e.clientX - r.left) / r.width) * STORY_W, ((e.clientY - r.top) / r.height) * STORY_H);
      if (i < 0) return;
      e.preventDefault();
      setActive(i);
      const k = Math.exp(-e.deltaY * 0.0015);
      update(i, (p) => storyZoom(p, p.z * k));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  const activeId = order[active]?.id;
  const activePos = activeId ? pos[activeId] || STORY_POS : null;

  // The saved file is drawn fresh, without the ring round the chosen photo.
  const toFile = () => new Promise((resolve, reject) => {
    try {
      const out = document.createElement('canvas');
      paint(out, drawOpts(-1));
      out.toBlob(
        (blob) => (blob ? resolve(new File([blob], `${slug}-story.jpg`, { type: 'image/jpeg' })) : reject(new Error('empty'))),
        'image/jpeg',
        0.93,
      );
    } catch (e) { reject(e); }
  });

  // Records the story with its video background, straight off the preview.
  const makeVideo = async () => {
    if (!canvasRef.current || (bg === 'video' && !videoRef.current)) return;
    preview.stop();
    if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
    setBusy('record');
    setError('');
    setActive(-1);
    recordingRef.current = true;
    try {
      const file = await recordStory({
        canvas: canvasRef.current,
        video: bg === 'video' ? videoRef.current : null,
        music: music && audioCtx ? { ctx: audioCtx, buffer: music.buffer, start: music.start, duration: music.duration } : null,
        render: (c) => paint(c, { ...latest.current, active: -1 }),
        name: `${slug}-story`,
        onProgress: (t) => setProgress(t),
      });
      setRecorded(file);
    } catch {
      setError('Could not make the video here. Try again, or save it as a photo instead.');
    } finally {
      recordingRef.current = false;
      setProgress(0);
      setBusy('');
      videoRef.current?.play().catch(() => {});
    }
  };

  const saveFile = (file) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const download = async () => {
    setBusy('download');
    setError('');
    try {
      saveFile(await toFile());
    } catch {
      setError('Could not save the story. Please try again.');
    } finally {
      setBusy('');
    }
  };

  // On a phone this opens the share sheet, where Instagram and Facebook
  // offer "Story" straight away.
  const canShareType = (type, ext) => typeof navigator !== 'undefined' && !!navigator.canShare
    && navigator.canShare({ files: [new File([''], `x.${ext}`, { type })] });
  const canShare = canShareType('image/jpeg', 'jpg');
  const canShareVideo = !!recorded && canShareType(recorded.type, recorded.name.split('.').pop());
  // `file` is a video already made - the share sheet must open straight from
  // the tap, and a recording takes longer than a browser lets a tap last.
  const share = async (file) => {
    setBusy('share');
    setError('');
    try {
      await navigator.share({ files: [file || await toFile()], title: event?.title || 'Event story' });
    } catch (e) {
      if (e?.name !== 'AbortError') setError('Sharing did not work here. Download the story, then post it from your gallery.');
    } finally {
      setBusy('');
    }
  };

  const ready = !!assets;

  return (
    <div className="ep-story" role="dialog" aria-modal="true" aria-label="Make a story" onClick={onClose}>
      <div className="ep-story-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ep-story-head">
          <h2><i className="fas fa-wand-magic-sparkles"></i> Your Story</h2>
          <button type="button" className="ep-lb-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>
        <div className="ep-story-body">
          <div className="ep-story-preview">
            <canvas
              ref={canvasRef}
              width={STORY_W}
              height={STORY_H}
              className={ready ? 'ready' : ''}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {!ready && <span className="ep-lb-wait"><span className="ep-spinner" /></span>}
          </div>
          <div className="ep-story-tools">
            <p className="ep-story-hint ep-story-how">
              <i className="fas fa-hand-pointer"></i> Drag a photo to move it inside its box. Pinch, scroll or use the slider to zoom.
            </p>
            {activePos && (
              <div className="ep-story-zoom">
                <i className="fas fa-magnifying-glass-minus"></i>
                <input
                  type="range"
                  min="1"
                  max={STORY_ZOOM_MAX}
                  step="0.01"
                  value={activePos.z}
                  aria-label="Zoom the chosen photo"
                  onChange={(e) => update(active, (p) => storyZoom(p, Number(e.target.value)))}
                />
                <i className="fas fa-magnifying-glass-plus"></i>
                <button type="button" className="ep-link" onClick={() => update(active, () => STORY_POS)}>Reset</button>
              </div>
            )}
            <p className="ep-story-label">Layout</p>
            <div className="ep-layouts">
              {layouts.map((l) => (
                <button
                  type="button"
                  key={l.key}
                  className={layout === l.key ? 'active' : ''}
                  onClick={() => setLayout(l.key)}
                  title={l.label}
                >
                  <span className="ep-layout-map">
                    {l.slots.map((sl, i) => (
                      <span
                        // eslint-disable-next-line react/no-array-index-key
                        key={i}
                        style={{
                          left: `${(sl.x / STORY_W) * 100}%`,
                          top: `${(sl.y / STORY_H) * 100}%`,
                          width: `${(sl.w / STORY_W) * 100}%`,
                          height: `${(sl.h / STORY_H) * 100}%`,
                          transform: sl.rot ? `rotate(${sl.rot}deg)` : undefined,
                        }}
                      />
                    ))}
                  </span>
                  <small>{l.label}</small>
                </button>
              ))}
            </div>
            <p className="ep-story-label">Style</p>
            <div className="ep-seg">
              {themes.map((t) => (
                <button
                  type="button"
                  key={t.key}
                  className={theme === t.key ? 'active' : ''}
                  onClick={() => setTheme(t.key)}
                >
                  <span className={`ep-swatch ep-swatch-${t.key}`} /> {t.label}
                </button>
              ))}
            </div>
            {canVideo && (
              <>
                <p className="ep-story-label">Background</p>
                <div className="ep-seg">
                  <button type="button" className={bg === 'design' ? 'active' : ''} onClick={() => setBg('design')} disabled={busy === 'record'}>
                    <i className="fas fa-image"></i> Design
                  </button>
                  <button type="button" className={bg === 'video' ? 'active' : ''} onClick={() => setBg('video')} disabled={busy === 'record'}>
                    <i className="fas fa-film"></i> Video
                  </button>
                </div>
                {bg === 'video' && !videoReady && <p className="ep-story-hint"><span className="ep-spinner" /> Loading the video…</p>}
              </>
            )}
            {canVideo && (
              <>
                <p className="ep-story-label">Music</p>
                {music ? (
                  <MusicCard
                    music={music}
                    preview={preview}
                    disabled={busy === 'record'}
                    onEdit={openMusic}
                    onRemove={() => { preview.stop(); setMusic(null); }}
                  />
                ) : (
                  <button type="button" className="ep-btn ep-btn-ghost ep-btn-sm ep-music-add" onClick={openMusic} disabled={busy === 'record'}>
                    <i className="fas fa-music"></i> Add music
                  </button>
                )}
              </>
            )}
            {name && (
              <label className="ep-story-check">
                <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
                Put my name on it
              </label>
            )}
            {order.length > 1 && (
              <button type="button" className="ep-btn ep-btn-ghost ep-btn-sm" onClick={() => { setOrder((o) => [...o.slice(1), o[0]]); setActive(-1); }}>
                <i className="fas fa-shuffle"></i> Swap photo places
              </button>
            )}
            <p className="ep-story-hint">
              {music
                ? `9:16 video with music, ${music.duration} seconds. Making it takes as long as the music plays - keep this screen open.`
                : bg === 'video'
                  ? `9:16 video, up to ${STORY_VIDEO_MAX_S} seconds. Making it takes as long as the video plays - keep this screen open.`
                  : '9:16 — the size of an Instagram or Facebook story.'}
            </p>
            {error && <p className="ep-error">{error}</p>}
            {isVideo ? (
              <div className="ep-story-actions">
                {!recorded ? (
                  <button type="button" className="ep-btn ep-btn-story" onClick={makeVideo} disabled={!ready || (bg === 'video' && !video) || !!busy}>
                    {busy === 'record'
                      ? <><span className="ep-spinner" /> Making video… {Math.floor(progress)}s</>
                      : <><i className={`fas ${music ? 'fa-music' : 'fa-video'}`}></i> {music ? 'Create video with music' : 'Create video'}</>}
                  </button>
                ) : (
                  <>
                    {canShareVideo && (
                      <button type="button" className="ep-btn ep-btn-story" onClick={() => share(recorded)} disabled={!!busy}>
                        {busy === 'share' ? <span className="ep-spinner" /> : <i className="fas fa-share-nodes"></i>} Share to Story
                      </button>
                    )}
                    <button type="button" className={`ep-btn ${canShareVideo ? 'ep-btn-ghost' : 'ep-btn-story'}`} onClick={() => saveFile(recorded)} disabled={!!busy}>
                      <i className="fas fa-download"></i> Download video
                    </button>
                  </>
                )}
                <button type="button" className="ep-link" onClick={download} disabled={!ready || !!busy}>
                  {music ? 'Save as a photo instead (no music)' : 'Save as a photo instead'}
                </button>
                <button type="button" className="ep-link" onClick={onDone}>Done</button>
              </div>
            ) : (
              <div className="ep-story-actions">
                {canShare && (
                  <button type="button" className="ep-btn ep-btn-story" onClick={() => share()} disabled={!ready || !!busy}>
                    {busy === 'share' ? <span className="ep-spinner" /> : <i className="fas fa-share-nodes"></i>} Share to Story
                  </button>
                )}
                <button type="button" className={`ep-btn ${canShare ? 'ep-btn-ghost' : 'ep-btn-story'}`} onClick={download} disabled={!ready || !!busy}>
                  {busy === 'download' ? <span className="ep-spinner" /> : <i className="fas fa-download"></i>} Download
                </button>
                <button type="button" className="ep-link" onClick={onDone}>Done</button>
              </div>
            )}
          </div>
        </div>
        {pickingMusic && audioCtx && (
          <MusicPicker
            ctx={audioCtx}
            initial={music}
            onClose={() => setPickingMusic(false)}
            onDone={(m) => { setMusic(m); setPickingMusic(false); }}
          />
        )}
      </div>
    </div>
  );
}

function Lightbox({ photos, index, from = null, onIndex, onClose: closeNow, onHeart = null, onDownload = null }) {
  const photo = photos[index];
  const touch = useRef(null);
  const [loaded, setLoaded] = useState('');
  const rootRef = useRef(null);
  const stageRef = useRef(null);

  // ---- In and out ----
  // It grows out of the thumbnail that was tapped and the room darkens; it
  // shrinks away when closed. The phone's Back button closes it too - the
  // viewer is a step in the history, like a page of its own.
  const closing = useRef(false);
  const ownEntry = useRef(false);
  const finish = useCallback(() => {
    if (!closing.current) closing.current = true;
    const stage = stageRef.current;
    const root = rootRef.current;
    if (calm() || !stage?.animate || !root?.animate) { closeNow(); return; }
    const opts = { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' };
    stage.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0.94)', opacity: 0 }], opts);
    root.animate([{ opacity: 1 }, { opacity: 0 }], opts).finished.then(closeNow, closeNow);
  }, [closeNow]);
  const onClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (ownEntry.current && window.history.state?.epLightbox) {
      ownEntry.current = false;
      window.history.back(); // its popstate is ignored below: closing already
    }
    finish();
  }, [finish]);
  useEffect(() => {
    window.history.pushState({ ...(window.history.state || {}), epLightbox: true }, '');
    ownEntry.current = true;
    const onPop = () => {
      ownEntry.current = false;
      if (closing.current) return;
      closing.current = true;
      finish();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const root = rootRef.current;
    if (calm() || !stage?.animate || !root?.animate) return;
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    const r = stage.getBoundingClientRect();
    if (from && r.width > 0) {
      const dx = (from.left + from.width / 2) - (r.left + r.width / 2);
      const dy = (from.top + from.height / 2) - (r.top + r.height / 2);
      const s = Math.max(0.05, from.width / r.width);
      stage.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.6 }, { transform: 'none', opacity: 1 }],
        { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    } else {
      stage.animate([{ transform: 'scale(0.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Next and previous slide the photo in from the side it comes from.
  const stepDir = useRef(0);
  const prev = useCallback(() => { stepDir.current = -1; onIndex((index - 1 + photos.length) % photos.length); }, [index, photos.length, onIndex]);
  const next = useCallback(() => { stepDir.current = 1; onIndex((index + 1) % photos.length); }, [index, photos.length, onIndex]);
  const firstIndex = useRef(index);
  useLayoutEffect(() => {
    if (index === firstIndex.current && !stepDir.current) return;
    const stage = stageRef.current;
    const d = stepDir.current || 1;
    stepDir.current = 0;
    if (calm() || !stage?.animate) return;
    stage.animate([{ transform: `translateX(${d * 42}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }, [index]);
  // Double-tap the photo to heart it, with the logo popping up in the middle.
  // A single tap on the photo does nothing here, so there is nothing to wait
  // for - two taps close together are the heart.
  const lastTap = useRef(0);
  const [pop, setPop] = useState(0);
  const tapPhoto = (e) => {
    e.stopPropagation();
    if (!onHeart) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      setPop(now);
      if (!photo.hearted) onHeart(photo);
    } else {
      lastTap.current = now;
    }
  };
  useEffect(() => { setPop(0); }, [index]);

  // The neighbours load while this one is looked at, so the next swipe is instant.
  useEffect(() => {
    preload(photos[(index + 1) % photos.length]?.full);
    preload(photos[(index - 1 + photos.length) % photos.length]?.full);
  }, [index, photos]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose, prev, next]);

  const ready = loaded === photo.full;

  return (
    <div
      ref={rootRef}
      className="ep-lightbox"
      onClick={onClose}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX);
        if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="ep-lb-top" onClick={(e) => e.stopPropagation()}>
        <span>{index + 1} / {photos.length}</span>
        <div>
          {onHeart && <HeartButton photo={photo} onToggle={onHeart} big />}
          {onDownload && (
            <button type="button" className="ep-lb-close" onClick={() => onDownload(photo)} aria-label="Download this photo" title="Download">
              <i className="fas fa-download"></i>
            </button>
          )}
          <button type="button" className="ep-lb-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>
      </div>
      {/* The thumbnail is already in the browser, so it shows at once; the
          sharp framed version fades in over it when it arrives. */}
      <div className="ep-lb-stage" ref={stageRef} onClick={tapPhoto}>
        {pop > 0 && <LovePop key={pop} big onDone={() => setPop(0)} />}
        <img className="ep-lb-thumb" src={photo.thumb} alt="" aria-hidden="true" />
        <img
          key={photo.full}
          className={`ep-lb-full ${ready ? 'ready' : ''}`}
          src={photo.full}
          alt={photo.caption || ''}
          decoding="async"
          onLoad={() => setLoaded(photo.full)}
        />
        {!ready && <span className="ep-lb-wait"><span className="ep-spinner" /></span>}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" className="ep-lb-nav prev" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous"><i className="fas fa-chevron-left"></i></button>
          <button type="button" className="ep-lb-nav next" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next"><i className="fas fa-chevron-right"></i></button>
        </>
      )}
    </div>
  );
}
