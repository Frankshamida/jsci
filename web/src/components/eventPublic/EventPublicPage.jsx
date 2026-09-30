'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  daysWith, formatClock, formatDay, groupProgramme, programmeKind, publicEventTitle, shortDay,
} from '@/lib/eventPublic';
import { normalizeUid, isPlausibleUid, wedgeCapture, WEDGE_IDLE_RESET_MS } from '@/lib/rfid';
import {
  STORY_H, STORY_LOGO_SRC, STORY_MAX, STORY_POS, STORY_THEMES, STORY_VIDEO_MAX_S, STORY_VIDEO_SRC, STORY_W, STORY_ZOOM_MAX,
  canRecordStory, recordStory, drawMusicSticker,
  drawStory, loadStoryArt, loadStoryFonts, loadStoryImage, storyLayouts, storyThemes, storyPan, storyPhotoUrl, storySlotAt, storySlots, storyZoom,
} from '@/lib/storyCard';
import { drawIdBack, drawIdFront, idQrText } from '@/lib/idCard';
import { useSongPlayer } from '@/components/songPlayer/useSongPlayer';
import { PlayerControls, SongRow, VinylStage } from '@/components/songPlayer/PlayerParts';
import { MusicCard, MusicPicker, makeAudioContext, useSegmentPreview } from './StoryMusic';

// The page an attendee's ID QR opens: /events/cebu-miracle-working-god.
//
//   Programme     the default view, open to anyone with the link
//   Event Photos  behind the attendee's password (LASTNAME@2026) or RFID card
//   Profile       the attendee's virtual ID, front and back - the same unlock
//
// The QR carries ?t=<code>, the attendee's own code. It is remembered per
// event, so switching tabs or coming back later still says their name, and it
// is what the unlock checks the password or card against.

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

const VIEWS = ['photos', 'profile', 'extras'];
const NO_SONGS = [];
const viewPath = (slug, view, code) => {
  const base = `/events/${slug}${VIEWS.includes(view) ? `/${view}` : ''}`;
  return code ? `${base}?t=${encodeURIComponent(code)}` : base;
};
// Which tab an address is: /events/<slug>[/photos|/profile|/extras].
const viewOf = (pathname) => VIEWS.find((v) => pathname.endsWith(`/${v}`)) || 'programme';

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
  useEffect(() => {
    const onPop = () => setView(viewOf(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (next) => {
    if (next === view) return;
    window.history.pushState(null, '', viewPath(slug, next, code));
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
  // /profile while locked (an old link, or Lock pressed there): the photos'
  // unlock first, and the Profile tab appears once it is done.
  useEffect(() => {
    if (unlocked !== false || (view !== 'profile' && view !== 'extras')) return;
    window.history.replaceState(null, '', viewPath(slug, 'photos', code));
    setView('photos');
  }, [unlocked, view, slug, code]);

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

  return (
    <main className={`ep-page ${showMiniPlayer ? 'has-mini-player' : ''}`}>
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
          {event.image_url && <img className="ep-hero-poster" src={event.image_url} alt="" />}
          <div className="ep-hero-text">
            <h1>{publicEventTitle(event)}</h1>
            {guestName && <p className="ep-welcome">Welcome {guestName},</p>}
            <div className="ep-meta">
              {when && <span><i className="fas fa-calendar-days"></i> {when}</span>}
              {event.location && <span><i className="fas fa-location-dot"></i> {event.location}</span>}
            </div>
          </div>
        </div>
      </header>

      <nav className="ep-tabs" aria-label="Event sections">
        <a
          href={viewPath(slug, 'programme', code)}
          className={view === 'programme' ? 'active' : ''}
          onClick={(e) => { e.preventDefault(); go('programme'); }}
        >
          <i className="fas fa-list-ol"></i> Programme
        </a>
        <a
          href={viewPath(slug, 'photos', code)}
          className={view === 'photos' ? 'active' : ''}
          onClick={(e) => { e.preventDefault(); go('photos'); }}
        >
          <i className="fas fa-images"></i> Event Photos
        </a>
        {unlocked && (
          <a
            href={viewPath(slug, 'profile', code)}
            className={`ep-tab-new ${view === 'profile' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); go('profile'); }}
          >
            <i className="fas fa-id-badge"></i> Profile
          </a>
        )}
        {unlocked && hasExtras && (
          <a
            href={viewPath(slug, 'extras', code)}
            className={`ep-tab-new ${view === 'extras' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); go('extras'); }}
          >
            <i className="fas fa-gift"></i> Extras
          </a>
        )}
      </nav>

      <section className="ep-body">
        {view === 'programme' && (
          <Programme
            event={event}
            items={info.programme}
            songsById={songsById}
            songsPaused={!!info.songsPaused}
            player={player}
            lineup={lineup}
            onPlayLineup={playLineup}
          />
        )}
        {view === 'photos' && <Photos event={event} slug={slug} code={code} year={info.passwordYear} name={guestName} onName={onUnlockedName} onLock={onLocked} />}
        {view === 'profile' && unlocked && <Profile slug={slug} code={code} year={info.passwordYear} onName={onUnlockedName} onLock={onLocked} />}
        {view === 'extras' && unlocked && <Extras info={extrasInfo} />}
      </section>

      <audio {...player.audioProps} />
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
function DayTabs({ days, value, onChange, all }) {
  return (
    <div className="ep-days" role="tablist">
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
        <span>{paused ? 'Song lineup' : `Song lineup · ${list.length}`}</span>
        {playingHere && <span className="sp-eq" aria-label="Playing"><i /><i /><i /></span>}
        <i className="fas fa-chevron-down ep-songs-chevron"></i>
      </button>

      {open && (paused ? (
        <p className="ep-songs-paused">
          <i className="fas fa-circle-pause"></i> Song playback is paused for now. Please sing along with the worship team!
        </p>
      ) : (
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
      ))}
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
      <div className="ep-np sp-scope sp-compact" role="dialog" aria-modal="true" aria-label="Now playing" onClick={(e) => e.stopPropagation()}>
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

function Programme({ event, items, songsById, songsPaused = false, player, lineup, onPlayLineup }) {
  // Every day the event runs has a tab, even one with nothing on it yet.
  const days = useMemo(() => {
    const grouped = new Map(groupProgramme(items).map((g) => [g.day, g.rows]));
    return daysWith(event, [...grouped.keys()]).map((d) => ({ day: d, rows: grouped.get(d) || [] }));
  }, [event, items]);
  // Opens on today when the event is on, else the first day.
  const [day, setDay] = useState(() => (days.find((d) => d.day === todayIso()) || days[0])?.day || '');
  const [clock, setClock] = useState(nowClock);
  useEffect(() => {
    const id = setInterval(() => setClock(nowClock()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!items?.length) {
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
  const nowId = isToday
    ? [...current.rows].reverse().find((r) => String(r.start_time).slice(0, 5) <= clock
      && (!r.end_time || String(r.end_time).slice(0, 5) > clock))?.id
    : null;

  return (
    <div className="ep-programme">
      {days.length > 1 && <DayTabs days={days.map((d) => d.day)} value={current.day} onChange={setDay} />}
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
          return (
            <li key={it.id} className={`ep-item ep-kind-${kind.key} ${it.id === nowId ? 'is-now' : ''}`}>
              <div className="ep-time">
                <strong>{formatClock(it.start_time)}</strong>
                {it.end_time && <span>{formatClock(it.end_time)}</span>}
              </div>
              <div className="ep-dot"><i className={`fas ${kind.icon}`}></i></div>
              <div className="ep-card">
                <div className="ep-card-top">
                  <span className="ep-chip">{kind.label}</span>
                  {it.id === nowId && <span className="ep-now">Happening now</span>}
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
  );
}

// ============================================================
// Photos
// ============================================================

function Photos({ event, slug, code, year, name, onName, onLock }) {
  const passKey = `evt-pass:${slug}`;
  const [pass, setPass] = useState('');
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(-1);
  const [day, setDay] = useState('all');
  // Story mode: the attendee picks up to STORY_MAX photos, in order.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState([]);
  const [story, setStory] = useState(null);
  const togglePick = (id) => setPicked((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    return cur.length >= STORY_MAX ? cur : [...cur, id];
  });
  const stopPicking = () => { setPicking(false); setPicked([]); };
  // The grid, the full view and the picker are all covered for screenshots.
  const covered = useScreenGuard();
  const block = (e) => e.preventDefault();

  useEffect(() => { setPass(store.get(passKey) || ''); }, [passKey]);

  // Day tabs only once photos are actually sorted by day.
  const days = useMemo(() => {
    const dated = (photos || []).map((p) => p.day).filter(Boolean);
    return dated.length ? daysWith(event, dated) : [];
  }, [event, photos]);
  const shown = useMemo(
    () => (day === 'all' ? photos || [] : (photos || []).filter((p) => p.day === day)),
    [photos, day],
  );

  // The list is kept for five minutes in this tab, so going back and forth
  // between Programme and Photos does not ask the server again.
  const listKey = `evt-photos:${slug}`;
  useEffect(() => {
    if (!pass) { setPhotos(null); return undefined; }
    let live = true;
    try {
      const hit = JSON.parse(window.sessionStorage.getItem(listKey) || 'null');
      if (hit?.pass === pass && Array.isArray(hit.data)) {
        setPhotos(hit.data);
        if (Date.now() - hit.at < 5 * 60_000) return undefined;
      }
    } catch { /* no cache */ }
    fetch(`/api/events/public/photos?slug=${encodeURIComponent(slug)}`, { headers: { 'x-event-pass': pass } })
      .then((r) => r.json())
      .then((data) => {
        if (!live) return;
        if (data.locked) { store.del(passKey); setPass(''); onLock(); return; }
        if (!data.success) { setError(data.message); return; }
        setPhotos(data.data || []);
        try { window.sessionStorage.setItem(listKey, JSON.stringify({ at: Date.now(), pass, data: data.data || [] })); } catch { /* full */ }
      })
      .catch(() => live && setError('Could not load the photos. Check your connection.'));
    return () => { live = false; };
  }, [pass, slug, passKey, listKey, onLock]);

  const unlocked = (result) => {
    store.set(passKey, result.pass);
    onName(result.name || '', result.code || '');
    setPass(result.pass);
  };

  const lock = () => {
    onLock();
    store.del(passKey);
    try { window.sessionStorage.removeItem(listKey); } catch { /* ignore */ }
    setPass('');
    setPhotos(null);
  };

  if (!pass) return <Unlock slug={slug} code={code} year={year} onUnlocked={unlocked} />;

  if (error) return <div className="ep-empty"><i className="fas fa-triangle-exclamation"></i><p>{error}</p></div>;
  if (!photos) return <div className="ep-loading"><span className="ep-spinner" /> Loading photos…</div>;

  return (
    <div className="ep-photos ep-id-protected" onContextMenu={block} onDragStart={block}>
      {covered && (
        <div className="ep-screen-cover" aria-hidden="true">
          <i className="fas fa-eye-slash"></i>
          <span>Photos hidden</span>
        </div>
      )}
      <div className="ep-photos-bar">
        {picking ? (
          <p>Pick up to <strong>{STORY_MAX}</strong> photos for your story</p>
        ) : (
          <p><strong>{shown.length}</strong> photo{shown.length === 1 ? '' : 's'}</p>
        )}
        <div className="ep-photos-actions">
          {picking ? (
            <button type="button" className="ep-link" onClick={stopPicking}><i className="fas fa-times"></i> Cancel</button>
          ) : (
            <>
              {photos.length > 0 && (
                <button type="button" className="ep-btn ep-btn-sm ep-btn-story" onClick={() => setPicking(true)}>
                  <i className="fas fa-wand-magic-sparkles"></i> Make a Story
                </button>
              )}
              <button type="button" className="ep-link" onClick={lock}><i className="fas fa-lock"></i> Lock</button>
            </>
          )}
        </div>
      </div>
      {days.length > 1 && (
        <DayTabs days={days} value={day} onChange={(d) => { setDay(d); setOpen(-1); }} all={`${photos.length} photos`} />
      )}
      {shown.length === 0 ? (
        <div className="ep-empty">
          <i className="fas fa-camera"></i>
          <h2>No photos yet</h2>
          <p>{day === 'all' ? 'Photos from the event' : `Day ${days.indexOf(day) + 1} photos`} will appear here once they are uploaded.</p>
        </div>
      ) : (
        <div className="ep-grid">
          {shown.map((p, i) => {
            const n = picked.indexOf(p.id);
            return (
              <button
                type="button"
                key={p.id}
                className={`ep-thumb ${picking ? 'is-picking' : ''} ${n >= 0 ? 'is-picked' : ''}`}
                onClick={() => (picking ? togglePick(p.id) : setOpen(i))}
                aria-pressed={picking ? n >= 0 : undefined}
              >
                <img src={p.thumb} alt={p.caption || `Event photo ${i + 1}`} loading="lazy" />
                {picking && <span className="ep-pick">{n >= 0 ? n + 1 : ''}</span>}
              </button>
            );
          })}
        </div>
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
        <Lightbox photos={shown} index={open} onIndex={setOpen} onClose={() => setOpen(-1)} />
      )}
    </div>
  );
}

function Unlock({
  slug, code, year, onUnlocked,
  icon = 'fa-lock', title = 'Event Photos',
  sub = 'For attendees only. Unlock with your password or your RFID card.',
  cta = 'Open Photos',
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
        setError(data.message || 'Could not unlock the photos.');
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

function Lightbox({ photos, index, onIndex, onClose }) {
  const photo = photos[index];
  const prev = useCallback(() => onIndex((index - 1 + photos.length) % photos.length), [index, photos.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % photos.length), [index, photos.length, onIndex]);
  const touch = useRef(null);
  const [loaded, setLoaded] = useState('');

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
          <button type="button" className="ep-lb-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>
      </div>
      {/* The thumbnail is already in the browser, so it shows at once; the
          sharp framed version fades in over it when it arrives. */}
      <div className="ep-lb-stage" onClick={(e) => e.stopPropagation()}>
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
