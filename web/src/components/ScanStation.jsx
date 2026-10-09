'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useRfidReader from '@/components/eventDesk/useRfidReader';
import { normalizeUid, isPlausibleUid, sameCard, formatUid } from '@/lib/rfid';
import { eventDaysOf, eventDayForToday, eventTodayKey, formatPersonName, guessDoorCheckIn } from '@/lib/eventFormat';
import { checkinTapFrom, publishCheckinDisplay } from '@/lib/checkinDisplay';
import { mealForNow, publishMealsDisplay } from '@/lib/mealsDisplay';

/* ============================================================
   A name screen that scans by itself.

   The door's screen (/rfid-chekin-display) and the Meals Counter's
   (/rfid-meals-display) normally show what the Admin dashboard's dialogs
   send them. With this, a reader plugged into the computer showing the
   screen - a USB reader, the Arduino, or the phone's own NFC - checks people
   in or gives the meal right there, with no dialog open anywhere. Both ways
   work side by side: whichever window has the reader's keystrokes answers
   the card, and the screen shows the taps of both.

   Who may: somebody signed in on this device as an Admin, a Super Admin or
   an Event Committee member for the event (api/rfid/station asks the server
   - nothing here is taken on the browser's word). Anyone else sees the screen
   as before.

   Fast: the name is up the moment the card is read, off the event's cards
   loaded once; one request per card, a few in flight at once; a card tapped
   twice in a row is one tap.
   ============================================================ */

// This screen's own taps, as one publisher among the desks.
export const STATION_ID = `screen-${Math.random().toString(36).slice(2, 10)}`;

// A card again this soon after it was tapped is one tap that bounced.
const BOUNCE_MS = 4000;
// Cards answered at once. More than enough for a queue, and polite to the server.
const IN_FLIGHT = 4;
// Answered taps kept on the line after the ones still being answered.
const KEEP_DONE = 8;
// How often the event's cards are read again, for cards given out meanwhile.
const CARDS_REFRESH_MS = 3 * 60 * 1000;

const BUSY = { checkin: ['reading', 'checking'], meals: ['reading', 'serving'] };
const MEAL_LABEL = { lunch: 'Lunch', dinner: 'Dinner' };
const prefsKey = (kind) => `jsci.station.${kind}.v1`;

// Who is signed in on this device: the main site's session, or the Event
// Committee portal's.
function signedInId() {
  for (const key of ['userData', 'committeeUser']) {
    for (const store of [() => window.sessionStorage, () => window.localStorage]) {
      try {
        const u = JSON.parse(store().getItem(key) || 'null');
        if (u?.id) return String(u.id);
      } catch { /* blocked storage */ }
    }
  }
  return '';
}

function readPrefs(kind) {
  try { return { on: true, eventId: '', ...JSON.parse(window.localStorage.getItem(prefsKey(kind)) || '{}') }; } catch { return { on: true, eventId: '' }; }
}

const dayKey = (iso) => String(iso || '').slice(0, 10);
// The event running today, by Manila's calendar - what a screen opens on.
function eventForToday(events) {
  const today = eventTodayKey();
  return events.find((e) => dayKey(e.event_date) <= today && today <= (dayKey(e.end_date) || dayKey(e.event_date))) || null;
}

/**
 * kind  'checkin' | 'meals'
 * desk  what the dashboard's dialog last sent: { eventId, day, meal } - the
 *       station follows it unless told otherwise on this screen
 */
export function useScanStation({ kind, desk = {} }) {
  const isMeals = kind === 'meals';
  const [who, setWho] = useState({ state: 'checking' });
  const [prefs, setPrefs] = useState({ on: true, eventId: '' });
  const [url, setUrl] = useState({});
  const [pickDay, setPickDay] = useState(0);
  const [pickMeal, setPickMeal] = useState('');
  const [clock, setClock] = useState(0);
  const [line, setLine] = useState([]);
  const lineRef = useRef([]);

  // ---- Who is signed in, and may they scan ----
  const check = useCallback(async () => {
    const id = signedInId();
    if (!id) { setWho({ state: 'signed-out' }); return; }
    try {
      const res = await fetch(`/api/rfid/station?userId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.success) setWho({ state: 'ok', staff: data.data.staff, events: data.data.events || [] });
      else setWho({ state: data.code === 'NOT_STAFF' ? 'not-staff' : 'signed-out', message: data.message });
    } catch {
      setWho((w) => (w.state === 'ok' ? w : { state: 'error', message: 'Could not reach the server.' }));
    }
  }, []);

  useEffect(() => {
    setPrefs(readPrefs(kind));
    const q = new URLSearchParams(window.location.search);
    setUrl({ eventId: q.get('event') || '', day: Number(q.get('day')) || 0, meal: MEAL_LABEL[q.get('meal')] ? q.get('meal') : '' });
    check();
    // Signed in or out in another tab of this browser.
    const onStorage = (e) => { if (!e.key || e.key === 'userData' || e.key === 'committeeUser') check(); };
    window.addEventListener('storage', onStorage);
    // The day rolls over at midnight and the meal at 3 pm, by the clock.
    const t = setInterval(() => setClock((c) => c + 1), 60000);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(t); };
  }, [kind, check]);

  const savePrefs = useCallback((patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try { window.localStorage.setItem(prefsKey(kind), JSON.stringify(next)); } catch { /* private window */ }
      return next;
    });
  }, [kind]);
  // Picked on the screen: kept on this device, and over the link's ?event=.
  const chooseEvent = useCallback((id) => {
    savePrefs({ eventId: id });
    setUrl((u) => ({ ...u, eventId: '' }));
    setPickDay(0);
  }, [savePrefs]);

  // ---- Which event, day and meal ----
  // Chosen here (the link or the picker) > what the desk is on > today's.
  const events = useMemo(() => (who.state === 'ok' ? who.events : []), [who]);
  const pinned = url.eventId || prefs.eventId;
  const event = useMemo(() => {
    const byId = (id) => (id ? events.find((e) => String(e.id) === String(id)) : null);
    return byId(pinned) || (!pinned && byId(desk.eventId)) || (!pinned && eventForToday(events)) || null;
  }, [events, pinned, desk.eventId]);
  const days = useMemo(() => eventDaysOf(event), [event, clock]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasDay = (n) => days.some((d) => d.number === n);
  const deskSameEvent = event && String(desk.eventId || '') === String(event.id);
  const day = (hasDay(pickDay) && pickDay)
    || (hasDay(url.day) && url.day)
    || (deskSameEvent && hasDay(Number(desk.day)) && Number(desk.day))
    || eventDayForToday(days) || 1;
  const meal = pickMeal || url.meal || (deskSameEvent && MEAL_LABEL[desk.meal] ? desk.meal : '') || mealForNow();

  const ready = who.state === 'ok' && prefs.on && !!event;
  const dayRow = days.find((d) => d.number === day);

  // What the screen's left half shows while this screen is scanning.
  const head = useMemo(() => {
    if (!ready) return null;
    return {
      event: {
        id: event.id, title: event.title || '', image: event.image_url || '',
        start: event.event_date || '', end: event.end_date || '', venue: event.location || '', city: event.loc_city || '',
      },
      day: { number: day, label: dayRow?.label || '', days: days.length > 1 ? days.length : 0, date: dayRow?.dateKey || '' },
      meal: { kind: meal, day, days: days.length > 1 ? days.length : 0, label: dayRow?.label || '', date: dayRow?.dateKey || '' },
    };
  }, [ready, event, day, dayRow, days.length, meal]);
  const headRef = useRef(head);
  headRef.current = head;

  // ---- The event's cards, for the name at the tap ----
  const cardsRef = useRef([]);
  const cardsAtRef = useRef(0);
  const eventId = ready ? event.id : null;
  const loadCards = useCallback(async (id) => {
    if (!id) { cardsRef.current = []; return; }
    cardsAtRef.current = Date.now();
    try {
      const res = await fetch(`/api/rfid/event-checkin?eventId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.success) cardsRef.current = (data.data || []).filter((r) => r.card?.uid).map((r) => ({ uid: r.card.uid, reg: r }));
    } catch { /* names come from the server's answer instead */ }
  }, []);
  useEffect(() => {
    cardsRef.current = [];
    if (!eventId) return undefined;
    loadCards(eventId);
    const t = setInterval(() => loadCards(eventId), CARDS_REFRESH_MS);
    return () => clearInterval(t);
  }, [eventId, loadCards]);

  // ---- The line ----
  const publish = useCallback(() => {
    const h = headRef.current;
    if (!h) return;
    const taps = lineRef.current.map(({ uid, tapped, ...t }) => t);
    if (isMeals) publishMealsDisplay({ from: STATION_ID, event: h.event, meal: h.meal, taps });
    else publishCheckinDisplay({ from: STATION_ID, event: h.event, day: h.day, taps });
  }, [isMeals]);

  const setLineTo = useCallback((list) => {
    const busy = BUSY[kind];
    const done = list.filter((e) => !busy.includes(e.status));
    const kept = new Set(done.slice(-KEEP_DONE).map((e) => e.seq));
    const next = list.filter((e) => busy.includes(e.status) || kept.has(e.seq));
    lineRef.current = next;
    setLine(next);
    publish();
  }, [kind, publish]);

  // What the server said about one card; a name it did not send keeps the
  // one put up at the tap.
  const patch = useCallback((seq, p) => {
    if (!lineRef.current.some((e) => e.seq === seq)) return;
    setLineTo(lineRef.current.map((e) => {
      if (e.seq !== seq) return e;
      const next = { ...e, ...p, t: Date.now() };
      ['name', 'first', 'last', 'church'].forEach((k) => { if (!p[k]) next[k] = e[k]; });
      return next;
    }));
  }, [setLineTo]);

  // A few cards answered at once; the rest wait their turn.
  const running = useRef(0);
  const queue = useRef([]);
  const pump = useCallback(() => {
    while (running.current < IN_FLIGHT && queue.current.length) {
      const job = queue.current.shift();
      running.current += 1;
      job().finally(() => { running.current -= 1; pump(); });
    }
  }, []);

  const readerRef = useRef(null);

  const onTap = useCallback((raw, source = 'keyboard') => {
    // The Arduino's LCD, when there is one: the name, or why not.
    const tell = (prefix, text) => readerRef.current?.sendToReader?.(prefix, text);
    const h = headRef.current;
    const staff = who.state === 'ok' ? who.staff : null;
    if (!h || !staff) return;
    const uid = normalizeUid(raw);
    if (!isPlausibleUid(uid)) return;
    const now = Date.now();
    const busy = BUSY[kind];
    if (lineRef.current.some((e) => sameCard(e.uid, uid)
      && (busy.includes(e.status) || (e.status !== 'error' && now - e.tapped < BOUNCE_MS)))) return;

    const seq = Math.max(now, (lineRef.current[lineRef.current.length - 1]?.seq || 0) + 1);
    const eventIdNow = h.event.id;
    const dayNow = h.day.number;
    const mealNow = h.meal.kind;
    const known = cardsRef.current.find((c) => sameCard(c.uid, uid))?.reg || null;
    const named = {
      name: known?.attendee_name || '', first: known?.attendee_firstname || '', last: known?.attendee_lastname || '',
      church: known?.church_name || '',
    };
    setLineTo([...lineRef.current, {
      seq, uid, tapped: now, t: now, day: dayNow,
      ...(isMeals
        ? { ...named, status: 'reading', meal: mealNow }
        : { ...checkinTapFrom(seq, known ? guessDoorCheckIn({ links: [{ uid, registration_id: known.id }], regs: [known] }, uid, dayNow) : null), ...named }),
    }]);
    // A card the cards on hand do not know may have been given out since.
    if (!known && Date.now() - cardsAtRef.current > 20000) loadCards(eventIdNow);

    queue.current.push(async () => {
      try {
        if (isMeals) {
          const res = await fetch('/api/rfid/station', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, eventId: eventIdNow, dayNumber: dayNow, meal: mealNow, actorId: staff.id, source: `screen-${source}` }),
          });
          const data = await res.json();
          if (!data.success) {
            patch(seq, { status: 'error' });
            tell('NO', 'Tap again');
            if (data.code === 'NOT_STAFF') check();
            return;
          }
          const reg = data.registration;
          const status = ['served', 'already', 'blocked', 'not_verified'].includes(data.result) ? data.result : 'unknown';
          patch(seq, {
            status, claimedAt: data.claimedAt || null,
            name: reg?.attendee_name || '', first: reg?.attendee_firstname || '', last: reg?.attendee_lastname || '', church: reg?.church_name || '',
          });
          const shown = formatPersonName(reg?.attendee_name || '');
          if (status === 'served') tell('OK', shown);
          else if (status === 'already') tell('DUP', shown);
          else tell('NO', status === 'blocked' ? 'Check in first' : status === 'not_verified' ? 'Not verified' : 'Unknown card');
        } else {
          const res = await fetch('/api/rfid/event-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, eventId: eventIdNow, dayNumber: dayNow, actorId: staff.id, source: `screen-${source}` }),
          });
          const data = await res.json();
          const tap = checkinTapFrom(seq, data.success ? data : { result: 'error' });
          patch(seq, tap);
          const shown = formatPersonName(data.registration?.attendee_name || '');
          if (tap.status === 'checked_in') tell('OK', shown);
          else if (tap.status === 'already_in') tell('DUP', shown);
          else tell('NO', tap.status === 'not_verified' ? 'Not verified' : tap.status === 'error' ? 'Tap again' : 'Unknown card');
        }
      } catch {
        patch(seq, { status: 'error' });
        tell('NO', 'Tap again');
      }
    });
    pump();
  }, [who, kind, isMeals, setLineTo, patch, pump, loadCards, check]);

  // Every reader at once - USB, the Arduino, the phone's NFC - while scanning.
  // The Arduino only once Connect was pressed here: one port, one holder, and
  // by default that is the dashboard's dialog.
  const reader = useRfidReader({ active: ready, onTap, autoSerial: !!prefs.arduino });
  readerRef.current = reader;

  // A new event, day or meal goes up on the screen straight away.
  useEffect(() => { if (head) publish(); }, [head, publish]);
  // Turned off, or a different event: its line is not this one's.
  useEffect(() => {
    queue.current = [];
    if (lineRef.current.length) setLineTo([]);
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    kind, who, prefs, savePrefs, chooseEvent, events, event, eventChoice: pinned || '', days, day, setPickDay, meal, setPickMeal,
    ready, head, line, onTap, reader, recheck: check,
  };
}

/* ---- The control on the screen ----
   One quiet chip in the corner - the screen faces a queue - that opens what
   this screen is scanning for. */
export function StationBar({ station }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const { who, prefs, ready, event, day, meal, kind, reader } = station;
  if (who.state === 'checking') return null;

  const dayCount = station.days.length;
  const live = [];
  if (ready) {
    if (reader.serialStatus === 'open') live.push('Arduino');
    if (reader.nfcStatus === 'scanning') live.push('NFC');
    if (!reader.isPhone) live.push('USB');
  }
  const label = who.state !== 'ok' ? 'Scan here'
    : !prefs.on ? 'Scanning off'
      : !event ? 'Choose an event to scan'
        : ['Scanning here', dayCount > 1 ? `Day ${day}` : '', kind === 'meals' ? MEAL_LABEL[meal] : ''].filter(Boolean).join(' · ');
  const tone = ready ? 'on' : who.state === 'ok' && prefs.on && !event ? 'warn' : 'off';

  const submit = () => {
    if (!isPlausibleUid(typed)) return;
    station.onTap(typed, 'manual');
    setTyped('');
  };

  return (
    <>
      <button type="button" className={`rcd-station-chip is-${tone}`} onClick={() => setOpen(true)} title="Scan on this screen">
        <span className="rcd-dot" aria-hidden="true"></span>
        <i className="fas fa-id-card"></i> {label}
        {ready && live.length > 0 && <small>{live.join(' + ')}</small>}
      </button>

      {open && (
        <div className="rcd-station-overlay" onClick={() => setOpen(false)}>
          <div className="rcd-station-sheet" role="dialog" aria-label="Scan on this screen" onClick={(e) => e.stopPropagation()}>
            <div className="rcd-station-head">
              <b><i className="fas fa-id-card"></i> Scan on this screen</b>
              <button type="button" className="rcd-station-x" onClick={() => setOpen(false)} aria-label="Close"><i className="fas fa-xmark"></i></button>
            </div>

            {who.state !== 'ok' ? (
              <div className="rcd-station-note">
                <p>
                  {who.state === 'not-staff'
                    ? (who.message || 'Only Admins and Event Committee members can scan here.')
                    : who.state === 'error'
                      ? who.message
                      : 'Sign in on this device as an Admin or an Event Committee member, and a card reader plugged in here checks people in on this screen - no dialog needed.'}
                </p>
                <div className="rcd-station-row">
                  <a className="rcd-station-btn" href="/login" target="_blank" rel="noreferrer"><i className="fas fa-right-to-bracket"></i> Sign in</a>
                  <button type="button" className="rcd-station-btn" onClick={station.recheck}><i className="fas fa-rotate"></i> I have signed in</button>
                </div>
              </div>
            ) : (
              <>
                <p className="rcd-station-who"><i className="fas fa-user-shield"></i> {who.staff?.name}</p>

                <label className="rcd-station-switch">
                  <input type="checkbox" checked={!!prefs.on} onChange={(e) => station.savePrefs({ on: e.target.checked })} />
                  <span>
                    <b>Scan on this screen</b>
                    <small>Off leaves the scanning to the dashboard&apos;s dialog. Both can be on at once.</small>
                  </span>
                </label>

                <div className="rcd-station-field">
                  <span>Event</span>
                  <select value={station.eventChoice} onChange={(e) => station.chooseEvent(e.target.value)}>
                    <option value="">{station.events.length ? 'Today’s event / the desk’s (automatic)' : 'No events you can work'}</option>
                    {station.events.map((e) => (
                      <option key={e.id} value={e.id}>{e.title}{e.event_date ? ` · ${dayKey(e.event_date)}` : ''}</option>
                    ))}
                  </select>
                  {!event && prefs.on && <em>No event is running today - choose one.</em>}
                </div>

                {event && dayCount > 1 && (
                  <div className="rcd-station-field">
                    <span>Day</span>
                    <div className="rcd-station-pills">
                      {station.days.map((d) => (
                        <button type="button" key={d.number} className={d.number === day ? 'on' : ''} onClick={() => station.setPickDay(d.number)}>
                          Day {d.number}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {event && kind === 'meals' && (
                  <div className="rcd-station-field">
                    <span>Serving</span>
                    <div className="rcd-station-pills">
                      {['lunch', 'dinner'].map((m) => (
                        <button type="button" key={m} className={m === meal ? 'on' : ''} onClick={() => station.setPickMeal(m)}>
                          <i className={`fas ${m === 'lunch' ? 'fa-sun' : 'fa-moon'}`}></i> {MEAL_LABEL[m]}
                        </button>
                      ))}
                    </div>
                    <em>A card tapped gets Day {day} {meal} straight away.</em>
                  </div>
                )}

                {ready && (
                  <div className="rcd-station-field">
                    <span>Readers</span>
                    <ul className="rcd-station-readers">
                      {!reader.isPhone && <li className="on"><i className="fas fa-keyboard"></i> USB reader - ready whenever this window is in front</li>}
                      {reader.webSerialSupported && (
                        <li className={reader.serialStatus === 'open' ? 'on' : ''}>
                          <i className="fas fa-microchip"></i>
                          {reader.serialStatus === 'open'
                            ? <>Arduino - connected <button type="button" onClick={() => { station.savePrefs({ arduino: false }); reader.disconnect(); }}>Disconnect</button></>
                            : <>Arduino - <button type="button" onClick={() => { station.savePrefs({ arduino: true }); reader.connect(); }}>Connect</button></>}
                        </li>
                      )}
                      {reader.nfcSupported && (
                        <li className={reader.nfcStatus === 'scanning' ? 'on' : ''}>
                          <i className="fas fa-wifi"></i>
                          {reader.nfcStatus === 'scanning'
                            ? 'Phone NFC - scanning'
                            : <>Phone NFC - <button type="button" onClick={() => reader.startNfc()}>Start</button></>}
                        </li>
                      )}
                    </ul>
                    {reader.error && <em className="bad">{reader.error}</em>}
                  </div>
                )}

                {ready && (
                  <div className="rcd-station-field">
                    <span>Type a card number</span>
                    <div className="rcd-station-row">
                      <input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                        placeholder="e.g. 00 02 50 34 85"
                        autoComplete="off"
                      />
                      <button type="button" className="rcd-station-btn" disabled={!isPlausibleUid(typed)} onClick={submit}>Scan</button>
                    </div>
                    {isPlausibleUid(typed) && <em>{formatUid(typed)}</em>}
                  </div>
                )}
              </>
            )}

            <div className="rcd-station-foot">
              <button type="button" className="rcd-station-btn primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
