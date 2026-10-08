'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { normalizeUid, isPlausibleUid, wedgeCapture, WEDGE_IDLE_RESET_MS } from '@/lib/rfid';
import { eventImageUrl } from '@/lib/eventImage';
import './accommodation.css';

// Find your room (/accommodation). Put it on a tablet or a laptop at the
// hotel, or open it on a phone: an attendee types their name - or taps their
// RFID card on the USB reader - and sees their room, the hotel, and who they
// share it with. Nothing on it changes anything.
//
//   /accommodation              the event on now (else the next one) with rooms
//   /accommodation?event=<id>   that event
//
// A result goes back to the search by itself after a while, so the next
// person in line never sees the last one's room.

const IDLE_MS = 45000;
const EVENT_KEY = 'accommodationKioskEvent';

const initials = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return w.length ? `${w[0][0]}${w.length > 1 ? w[w.length - 1][0] : ''}`.toUpperCase() : '?';
};
const dateOf = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

async function ask(params) {
  try {
    const res = await fetch(`/api/events/accommodation-lookup?${new URLSearchParams(params)}`, { cache: 'no-store' });
    return await res.json().catch(() => ({ success: false, message: `The server answered ${res.status}.` }));
  } catch {
    return { success: false, message: 'Could not reach the server. Check the connection.' };
  }
}

function Kiosk() {
  const params = useSearchParams();
  const [events, setEvents] = useState(null);
  const [eventId, setEventId] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null); // null: nothing searched
  const [searching, setSearching] = useState(false);
  const [stay, setStay] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cardState, setCardState] = useState(null); // { busy } | { error }
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const idleRef = useRef(null);

  // ---- Which event ----
  useEffect(() => {
    (async () => {
      const res = await ask({ events: 1 });
      const list = res.success ? res.events || [] : [];
      setEvents(list);
      if (!res.success) { setError(res.message); return; }
      let saved = '';
      try { saved = window.localStorage.getItem(EVENT_KEY) || ''; } catch { /* private mode */ }
      const wanted = params.get('event');
      const pick = list.find((e) => e.id === wanted) || list.find((e) => e.id === saved && list[0]?.now !== true) || list[0];
      if (pick) setEventId(pick.id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const event = (events || []).find((e) => e.id === eventId) || null;
  const pickEvent = (id) => {
    setEventId(id);
    reset();
    try { window.localStorage.setItem(EVENT_KEY, id); } catch { /* private mode */ }
  };

  // ---- Back to the search ----
  const reset = useCallback(() => {
    setStay(null);
    setQuery('');
    setMatches(null);
    setCardState(null);
    setError('');
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
  }, []);
  const touch = useCallback(() => {
    clearTimeout(idleRef.current);
    if (stay) idleRef.current = setTimeout(reset, IDLE_MS);
  }, [stay, reset]);
  useEffect(() => { touch(); return () => clearTimeout(idleRef.current); }, [stay, touch]);

  // ---- Searching by name ----
  useEffect(() => {
    const q = query.trim();
    if (!eventId || q.replace(/\s/g, '').length < 3) { setMatches(null); return undefined; }
    // A card number being typed by the reader is not a name.
    if (/^[0-9A-Fa-f:\s-]{6,}$/.test(q) && /\d/.test(q)) return undefined;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await ask({ eventId, q });
      setSearching(false);
      setMatches(res.success ? res.matches || [] : []);
      if (!res.success) setError(res.message);
    }, 250);
    return () => clearTimeout(t);
  }, [query, eventId]);

  const open = async (registrationId) => {
    setBusy(true);
    setError('');
    const res = await ask({ eventId, registrationId });
    setBusy(false);
    if (!res.success) { setError(res.message); return; }
    setStay(res.stay);
  };

  // ---- A card on the reader ----
  // A USB reader types the number and presses Enter, far faster than hands.
  // The whole page listens - in the name box too - and a tap is told from
  // typing by its speed (lib/rfid wedgeCapture). What it typed into the box
  // is taken back out.
  const tapRef = useRef(null);
  tapRef.current = async (raw) => {
    const uid = normalizeUid(raw);
    if (!eventId || !isPlausibleUid(uid)) return;
    setCardState({ busy: true });
    setError('');
    const res = await ask({ eventId, uid });
    if (!res.success) { setCardState({ error: res.message }); return; }
    setCardState(null);
    setStay(res.stay);
  };
  useEffect(() => {
    const key = { buf: '', at: 0, gaps: [] };
    const onKeyDown = (e) => {
      const now = Date.now();
      if (now - key.at > WEDGE_IDLE_RESET_MS) { key.buf = ''; key.gaps = []; }
      else if (key.buf || e.key === 'Enter') key.gaps.push(now - key.at);
      key.at = now;
      if (e.key === 'Enter') {
        const typed = key.buf;
        const captured = wedgeCapture(typed, key.gaps);
        key.buf = '';
        key.gaps = [];
        if (captured) {
          e.preventDefault();
          setQuery((q) => (q.endsWith(typed) ? q.slice(0, -typed.length) : q));
          tapRef.current?.(captured);
        }
        return;
      }
      if (e.key.length === 1) key.buf += e.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cover = event?.image ? eventImageUrl(event.image, 1200) : '';

  return (
    <div className="acck" onPointerDown={touch} onKeyDown={touch}>
      <div className="acck-bg" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} aria-hidden="true" />
      <header className="acck-head">
        <div className="acck-brand">
          <span className="acck-logo"><i className="fas fa-bed"></i></span>
          <div>
            <h1>Find your room</h1>
            <p>{event ? [event.title, event.place, dateOf(event.eventDate)].filter(Boolean).join(' · ') : 'Accommodation'}</p>
          </div>
        </div>
        {(events || []).length > 1 && (
          <select className="acck-event" value={eventId} onChange={(e) => pickEvent(e.target.value)} aria-label="Event">
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}{e.place ? ` · ${e.place}` : ''}</option>)}
          </select>
        )}
      </header>

      {events === null ? (
        <main className="acck-card acck-center"><i className="fas fa-spinner fa-spin"></i> Loading…</main>
      ) : !event ? (
        <main className="acck-card acck-center">
          <i className="fas fa-hotel"></i>
          <p>{error || 'No event has rooms set up yet.'}</p>
        </main>
      ) : stay ? (
        <Stay stay={stay} onDone={reset} />
      ) : (
        <main className="acck-find">
          {/* ---- Tap the card ---- */}
          <section className={`acck-card acck-tap ${cardState?.busy ? 'is-busy' : ''} ${cardState?.error ? 'is-bad' : ''}`}>
            <div className="acck-ring">
              <i className={`fas ${cardState?.busy ? 'fa-spinner fa-spin' : cardState?.error ? 'fa-circle-exclamation' : 'fa-wifi'}`}></i>
            </div>
            <b>{cardState?.busy ? 'Reading your card…' : 'Tap your RFID card'}</b>
            <p>{cardState?.error || 'Hold your event ID card on the reader - your room shows straight away.'}</p>
          </section>

          <div className="acck-or"><span>or</span></div>

          {/* ---- Search the name ---- */}
          <section className="acck-card acck-search">
            <label htmlFor="acck-q">Search your name</label>
            <div className="acck-input">
              <i className="fas fa-magnifying-glass"></i>
              <input
                id="acck-q"
                ref={inputRef}
                type="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-lpignore="true"
                data-form-type="other"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setError(''); }}
                placeholder="First name and last name"
                autoFocus
              />
              {query && <button type="button" onClick={reset} aria-label="Clear"><i className="fas fa-xmark"></i></button>}
            </div>
            {query.trim().replace(/\s/g, '').length > 0 && query.trim().replace(/\s/g, '').length < 3 && (
              <p className="acck-hint">Keep typing - at least three letters.</p>
            )}
            {searching && <p className="acck-hint"><i className="fas fa-spinner fa-spin"></i> Searching…</p>}
            {!searching && matches && matches.length === 0 && (
              <p className="acck-hint">Nobody at this event matches &ldquo;{query.trim()}&rdquo;. Try your first and last name as you registered.</p>
            )}
            {!searching && matches && matches.length > 0 && (
              <ul className="acck-matches">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => open(m.id)} disabled={busy}>
                      <span className="acck-avatar">{initials(m.name)}</span>
                      <span className="acck-who"><b>{m.name}</b>{m.church && <small>{m.church}</small>}</span>
                      <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-chevron-right'}`}></i>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && !matches && <p className="acck-hint is-bad">{error}</p>}
          </section>
        </main>
      )}
    </div>
  );
}

function Stay({ stay, onDone }) {
  const { person, room, hotel } = stay;
  return (
    <main className="acck-result">
      <section className="acck-card acck-me">
        <span className="acck-avatar is-big">{initials(person.name)}</span>
        <div>
          <small>Welcome,</small>
          <h2>{person.name}</h2>
          {person.church && <p>{person.church}</p>}
        </div>
      </section>

      {stay.state === 'assigned' && room ? (
        <>
          <section className="acck-card acck-room">
            <span className="acck-room-label">Your room</span>
            <b className="acck-room-no">{room.number}</b>
            <span className="acck-room-type">{[room.type, room.floor].filter(Boolean).join(' · ')}</span>
            <div className="acck-room-facts">
              {room.bedsText && <span><i className="fas fa-bed"></i> {room.bedsText}</span>}
              {room.occupancy && <span><i className="fas fa-people-roof"></i> {room.occupancy}</span>}
              {room.pax && <span><i className="fas fa-user-group"></i> {room.pax} pax</span>}
            </div>
            {stay.sharesBedWith && (
              <p className="acck-note"><i className="fas fa-child"></i> You share <b>{stay.sharesBedWith}</b>&apos;s bed.</p>
            )}
            {stay.myKids?.length > 0 && (
              <p className="acck-note"><i className="fas fa-child"></i> With you in your bed: <b>{stay.myKids.join(', ')}</b></p>
            )}
            {hotel?.name && (
              <p className="acck-hotel"><i className="fas fa-hotel"></i> <span><b>{hotel.name}</b>{hotel.address && <small>{hotel.address}</small>}</span></p>
            )}
          </section>

          <section className="acck-card acck-mates">
            <h3><i className="fas fa-users"></i> Sharing the room with you {stay.roommates.length > 0 && <em>{stay.roommates.length}</em>}</h3>
            {stay.roommates.length === 0 ? (
              <p className="acck-hint">Nobody else is in this room yet.</p>
            ) : (
              <ul>
                {stay.roommates.map((m, i) => (
                  <li key={`${m.name}-${i}`}>
                    <span className="acck-avatar">{initials(m.name)}</span>
                    <span className="acck-who">
                      <b>{m.name}</b>
                      {m.church && <small>{m.church}</small>}
                      {m.kids?.length > 0 && <span className="acck-kids">{m.kids.map((k) => <em key={k}><i className="fas fa-child"></i> Kid: {k}</em>)}</span>}
                    </span>
                    {m.bedOf && <span className="acck-tag is-bed">Your bed</span>}
                    {m.sameGroup && !m.bedOf && <span className="acck-tag">Same booking</span>}
                    {m.kind === 'guest' && <span className="acck-tag is-guest">Guest</span>}
                    {m.kind === 'reserved' && <span className="acck-tag is-res">Arriving</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="acck-card acck-center acck-noroom">
          <i className={`fas ${stay.state === 'none' ? 'fa-circle-info' : 'fa-hourglass-half'}`}></i>
          {stay.state === 'reserved' ? (
            <p>A bed is reserved for you{stay.reserved ? <> in <b>Room {stay.reserved.number}</b></> : ''}. Please see the accommodation desk to confirm it.</p>
          ) : stay.state === 'waiting' ? (
            <p>You have accommodation, but no room is assigned to you yet. Please see the accommodation desk.</p>
          ) : (
            <p>You did not avail accommodation for this event. Please see the registration desk if you need a room.</p>
          )}
          {hotel?.name && stay.state !== 'none' && <p className="acck-hint"><i className="fas fa-hotel"></i> {hotel.name}</p>}
        </section>
      )}

      <button type="button" className="acck-done" onClick={onDone}>
        <i className="fas fa-magnifying-glass"></i> Search another name
      </button>
    </main>
  );
}

export default function AccommodationPage() {
  return (
    <Suspense fallback={null}>
      <Kiosk />
    </Suspense>
  );
}
