'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  daysWith, formatClock, formatDay, groupProgramme, programmeKind, publicEventTitle, shortDay,
} from '@/lib/eventPublic';
import { normalizeUid, isPlausibleUid } from '@/lib/rfid';
import {
  STORY_H, STORY_LOGO_SRC, STORY_MAX, STORY_POS, STORY_THEMES, STORY_W, STORY_ZOOM_MAX,
  drawStory, loadStoryFonts, loadStoryImage, storyLayouts, storyPan, storyPhotoUrl, storySlotAt, storySlots, storyZoom,
} from '@/lib/storyCard';

// The page an attendee's ID QR opens: /events/cebu-miracle-working-god.
//
//   Programme     the default view, open to anyone with the link
//   Event Photos  behind the attendee's password (LASTNAME@2026) or RFID card
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

const viewPath = (slug, view, code) => {
  const base = `/events/${slug}${view === 'photos' ? '/photos' : ''}`;
  return code ? `${base}?t=${encodeURIComponent(code)}` : base;
};

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
          const photos = window.location.pathname.endsWith('/photos');
          window.location.replace(viewPath(data.redirect, photos ? 'photos' : 'programme', t));
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
    const onPop = () => setView(window.location.pathname.endsWith('/photos') ? 'photos' : 'programme');
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
  useEffect(() => {
    if (store.get(`evt-pass:${slug}`)) setUnlockedName(store.get(nameKey) || '');
  }, [slug, nameKey]);
  const onUnlockedName = useCallback((name, unlockedCode) => {
    setForgotten(false);
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
    setUnlockedName('');
    setForgotten(true);
    store.del(nameKey);
    // A code remembered from an older QR would bring the name straight back.
    store.del(`evt-code:${slug}`);
    setCode('');
  }, [nameKey, slug]);
  const guestName = unlockedName || (forgotten ? '' : info?.guest?.name) || '';

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
    <main className="ep-page">
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
      </nav>

      <section className="ep-body">
        {view === 'programme'
          ? <Programme event={event} items={info.programme} />
          : <Photos event={event} slug={slug} code={code} year={info.passwordYear} name={guestName} onName={onUnlockedName} onLock={onLocked} />}
      </section>

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

function Programme({ event, items }) {
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
    <div className="ep-photos">
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

function Unlock({ slug, code, year, onUnlocked }) {
  const [mode, setMode] = useState('password');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sameLast, setSameLast] = useState(false);
  const [nfcState, setNfcState] = useState('');
  const cardRef = useRef(null);
  const [cardBuf, setCardBuf] = useState('');

  const hasNfc = typeof window !== 'undefined' && 'NDEFReader' in window;
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
    if (mode !== 'rfid') return undefined;
    setTimeout(() => cardRef.current?.focus(), 50);
    const key = { buf: '', at: 0 };
    const onKeyDown = (e) => {
      if (e.target === cardRef.current) return; // the box handles its own
      const now = Date.now();
      if (now - key.at > 120) key.buf = '';
      key.at = now;
      if (e.key === 'Enter') {
        const captured = key.buf;
        key.buf = '';
        if (isPlausibleUid(captured)) { e.preventDefault(); sendRef.current?.(captured); }
        return;
      }
      if (e.key.length === 1) key.buf += e.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  const sendCard = (raw) => {
    const uid = normalizeUid(raw);
    setCardBuf('');
    if (!isPlausibleUid(uid)) { setError('That card could not be read. Please tap it again.'); return; }
    submit({ uid });
  };
  sendRef.current = sendCard;

  // Android Chrome can read the card on the phone itself.
  const scanWithPhone = async () => {
    setError('');
    try {
      // eslint-disable-next-line no-undef
      const reader = new NDEFReader();
      const ctrl = new AbortController();
      await reader.scan({ signal: ctrl.signal });
      setNfcState('Hold your ID card against the back of your phone…');
      reader.onreading = (e) => {
        ctrl.abort();
        setNfcState('');
        sendCard(e.serialNumber || '');
      };
      reader.onreadingerror = () => setError('The card could not be read. Try holding it still.');
    } catch (e) {
      setNfcState('');
      setError(e?.name === 'NotAllowedError' ? 'Allow NFC access to scan your card.' : 'NFC is not available on this phone.');
    }
  };

  return (
    <div className="ep-lock">
      <div className="ep-lock-icon"><i className="fas fa-lock"></i></div>
      <h2>Event Photos</h2>
      <p className="ep-lock-sub">For attendees only. Unlock with your password or your RFID card.</p>

      <div className="ep-seg" role="tablist">
        <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => { setMode('password'); setError(''); }}>
          <i className="fas fa-key"></i> Password
        </button>
        <button type="button" className={mode === 'rfid' ? 'active' : ''} onClick={() => { setMode('rfid'); setError(''); }}>
          <i className="fas fa-id-card"></i> RFID Card
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
            {busy ? <span className="ep-spinner" /> : <i className="fas fa-unlock"></i>} Open Photos
          </button>
        </form>
      ) : (
        <div className="ep-form">
          <div className={`ep-tap ${busy ? 'busy' : ''}`} onClick={() => cardRef.current?.focus()}>
            <i className="fas fa-wifi"></i>
            <strong>{busy ? 'Checking your card…' : 'Tap your ID card on the reader'}</strong>
            <span>{nfcState || 'Keep this page open while you tap.'}</span>
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
          {hasNfc && (
            <button type="button" className="ep-btn ep-btn-ghost" onClick={scanWithPhone} disabled={busy}>
              <i className="fas fa-mobile-screen"></i> Scan card with this phone
            </button>
          )}
        </div>
      )}

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
  const layouts = storyLayouts(photos.length);
  const [layout, setLayout] = useState(layouts[0].key);
  const [theme, setTheme] = useState('red');
  const [showName, setShowName] = useState(!!name);
  const [assets, setAssets] = useState(null); // { logo, byId: { [photoId]: img } }
  // Where each photo sits in its box, by photo id - so it keeps its place
  // when the photos swap boxes or the layout changes.
  const [pos, setPos] = useState({});
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([
      loadStoryFonts(),
      storyImage(STORY_LOGO_SRC),
      Promise.all(photos.map((p) => storyImage(storyPhotoUrl(p)))),
    ]).then(([, logo, images]) => {
      if (!live) return;
      if (images.every((img) => !img)) setError('Could not load the photos. Check your connection and try again.');
      setAssets({ logo, byId: Object.fromEntries(photos.map((p, i) => [p.id, images[i]])) });
    });
    return () => { live = false; };
  }, [photos]);

  const slots = storySlots(order.length, layout);
  const images = assets ? order.map((p) => assets.byId[p.id] || null) : [];
  const positions = order.map((p) => pos[p.id] || STORY_POS);
  const drawOpts = (ring) => ({
    images, logo: assets?.logo, theme, event, layout, positions, active: ring, name: showName ? name : '',
  });

  // Redrawn at most once a frame, however fast a finger moves.
  const frame = useRef(0);
  const latest = useRef(null);
  latest.current = drawOpts(active);
  useEffect(() => {
    if (!assets || !canvasRef.current) return undefined;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => canvasRef.current && drawStory(canvasRef.current, latest.current));
    return () => cancelAnimationFrame(frame.current);
  });

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
      drawStory(out, drawOpts(-1));
      out.toBlob(
        (blob) => (blob ? resolve(new File([blob], `${slug}-story.jpg`, { type: 'image/jpeg' })) : reject(new Error('empty'))),
        'image/jpeg',
        0.93,
      );
    } catch (e) { reject(e); }
  });

  const download = async () => {
    setBusy('download');
    setError('');
    try {
      const file = await toFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Could not save the story. Please try again.');
    } finally {
      setBusy('');
    }
  };

  // On a phone this opens the share sheet, where Instagram and Facebook
  // offer "Story" straight away.
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare
    && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });
  const share = async () => {
    setBusy('share');
    setError('');
    try {
      const file = await toFile();
      await navigator.share({ files: [file], title: event?.title || 'Event story' });
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
              {STORY_THEMES.map((t) => (
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
            <p className="ep-story-hint">9:16 — the size of an Instagram or Facebook story.</p>
            {error && <p className="ep-error">{error}</p>}
            <div className="ep-story-actions">
              {canShare && (
                <button type="button" className="ep-btn ep-btn-story" onClick={share} disabled={!ready || !!busy}>
                  {busy === 'share' ? <span className="ep-spinner" /> : <i className="fas fa-share-nodes"></i>} Share to Story
                </button>
              )}
              <button type="button" className={`ep-btn ${canShare ? 'ep-btn-ghost' : 'ep-btn-story'}`} onClick={download} disabled={!ready || !!busy}>
                {busy === 'download' ? <span className="ep-spinner" /> : <i className="fas fa-download"></i>} Download
              </button>
              <button type="button" className="ep-link" onClick={onDone}>Done</button>
            </div>
          </div>
        </div>
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
  const [saving, setSaving] = useState(null); // null = idle, 0-100 = percent, -1 = size unknown

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

  // Fetched rather than followed as a link, so a 6000 x 4000 file shows
  // progress and the page never navigates away. If the browser cannot, the
  // file opens in a new tab instead.
  const download = async () => {
    if (saving !== null) return;
    setSaving(0);
    try {
      const res = await fetch(photo.download);
      if (!res.ok || !res.body) throw new Error('download failed');
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        setSaving(total ? Math.round((got / total) * 100) : -1);
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: 'image/jpeg' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Event-Photo-${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      window.open(photo.download, '_blank', 'noopener');
    } finally {
      setSaving(null);
    }
  };

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
          <button type="button" className="ep-btn ep-btn-sm" onClick={download} disabled={saving !== null}>
            {saving === null
              ? <><i className="fas fa-download"></i> Download</>
              : <><span className="ep-spinner" /> {saving > 0 ? `${saving}%` : 'Preparing…'}</>}
          </button>
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
