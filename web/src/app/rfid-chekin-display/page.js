'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeCheckinDisplay } from '@/lib/checkinDisplay';
import { isPosterUrl } from '@/lib/mealsDisplay';
import { eventImageUrl } from '@/lib/eventImage';
import { formatPersonName } from '@/lib/eventFormat';
import { drawIdFront, ID_ORIGINAL_SCALE } from '@/lib/idCard';
import './checkinDisplay.css';

// The screen at the door (/rfid-chekin-display). Put it on a TV or a monitor
// facing the queue, driven by "Scan RFID to Check In":
//
//   left   WELCOME DELEGATES, and the event - its name, dates, venue, the day
//   right  the front of the ID, big. Every card tapped turns it over to that
//          attendee's own ID, their name printed as the ID prints it; with
//          nobody at the door it turns back to the blank ID.
//
// Under the card, whether they are in - welcome, already in, see the desk.

// How long an attendee's ID stays up with nobody else tapping.
const HOLD_MS = 12000;
// How long one turn of the card takes - matches .rcd-card's transition.
const FLIP_MS = 950;
// The template's own resolution: as sharp as the printed ID, on any screen.
const SCALE = ID_ORIGINAL_SCALE;

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };
const TZ = 'Asia/Manila';

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '');
const dayKey = (iso) => String(iso || '').slice(0, 10);
const fmtDay = (key, opts) => new Date(`${key}T12:00:00+08:00`).toLocaleDateString('en-US', { timeZone: TZ, ...opts });

// "October 8-9, 2026", "Sep 30 - Oct 2, 2026", "October 8, 2026".
function datesOf(start, end) {
  const a = dayKey(start);
  const b = dayKey(end) || a;
  if (!a) return '';
  if (a === b) return fmtDay(a, { month: 'long', day: 'numeric', year: 'numeric' });
  if (a.slice(0, 7) === b.slice(0, 7)) return `${fmtDay(a, { month: 'long', day: 'numeric' })}-${fmtDay(b, { day: 'numeric' })}, ${b.slice(0, 4)}`;
  return `${fmtDay(a, { month: 'short', day: 'numeric' })} - ${fmtDay(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// What it says under the card for each outcome at the door.
function describe(tap, day, days) {
  const onDay = days > 1 ? `Day ${tap.day || day}` : 'today';
  switch (tap.status) {
    case 'checked_in':
      return { tone: 'ok', icon: 'fa-circle-check', headline: 'Welcome! You’re checked in', note: `Checked in for ${onDay}${tap.attendedAt ? ` · ${timeOf(tap.attendedAt)}` : ''}` };
    case 'checking':
      return { tone: 'ok', icon: 'fa-circle-check', headline: 'Welcome!', note: `Checking you in for ${onDay}…`, busy: true };
    case 'already_in':
      return { tone: 'warn', icon: 'fa-clock-rotate-left', headline: 'Already checked in', note: tap.attendedAt ? `You checked in for ${onDay} at ${timeOf(tap.attendedAt)}` : `You are already in for ${onDay}` };
    case 'not_verified':
      return { tone: 'bad', icon: 'fa-user-clock', headline: 'Not verified yet', note: 'Please see the registration desk.' };
    case 'unknown':
      return { tone: 'bad', icon: 'fa-circle-exclamation', headline: 'Card not recognised', note: 'Please see the person at the desk.' };
    case 'error':
      return { tone: 'bad', icon: 'fa-rotate-right', headline: 'Please tap again', note: 'Your card could not be read just now.' };
    default:
      return { tone: 'info', icon: 'fa-wifi', headline: 'Welcome!', note: 'Checking your card…', busy: true };
  }
}

// The name as the ID prints it: last name over first name. The registration's
// own two fields when the door sent them; otherwise the full name, split at
// its last word.
function idNames(tap) {
  const first = String(tap?.first || '').trim();
  const last = String(tap?.last || '').trim();
  if (first || last) return { firstName: formatPersonName(first), lastName: formatPersonName(last) };
  const words = formatPersonName(tap?.name || '').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1) return { firstName: '', lastName: words[0] };
  return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] };
}
const BLANK = { firstName: '', lastName: '' };

// ---- The card ----
// Two faces, both an ID front, back to back. The next attendee is drawn on
// the face turned away, then the card turns half a turn - always the same
// way - so every tap is a flip and every flip lands on the new name.
function FlipId({ who }) {
  const faceA = useRef(null);
  const faceB = useRef(null);
  const turnRef = useRef(0);
  const [turn, setTurn] = useState(0);
  const [lifting, setLifting] = useState(false);
  const [ready, setReady] = useState(false);
  const shown = useRef({ key: 'idle', blank: true });
  const queue = useRef(Promise.resolve());
  const whoRef = useRef(who);
  whoRef.current = who;

  // The blank ID first, on the face that is showing.
  useEffect(() => {
    let live = true;
    drawIdFront(faceA.current, BLANK, SCALE).then(() => live && setReady(true)).catch(() => live && setReady(true));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const next = whoRef.current;
    if (!next || next.key === shown.current.key) return;
    // Back to nobody while the blank ID is already up: nothing to turn.
    if (!next.names && next.idle && shown.current.blank) { shown.current = { key: next.key, blank: true }; return; }
    queue.current = queue.current.then(async () => {
      const latest = whoRef.current;
      if (!latest || latest.key !== next.key) return; // somebody newer is already waiting
      const hidden = (turnRef.current + 1) % 2 === 1 ? faceB.current : faceA.current;
      await drawIdFront(hidden, next.names || BLANK, SCALE).catch(() => {});
      shown.current = { key: next.key, blank: !next.names };
      turnRef.current += 1;
      setTurn(turnRef.current);
      setLifting(true);
      await new Promise((r) => setTimeout(r, FLIP_MS));
      setLifting(false);
    });
  }, [who?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`rcd-lift ${lifting ? 'is-lifting' : ''} ${ready ? 'is-ready' : ''}`}>
      <div className="rcd-card" style={{ transform: `rotateY(${turn * 180}deg)` }}>
        <div className="rcd-face"><canvas ref={faceA} aria-hidden="true" /></div>
        <div className="rcd-face rcd-back"><canvas ref={faceB} aria-hidden="true" /></div>
      </div>
      <span className="rcd-shine" aria-hidden="true" key={turn} />
    </div>
  );
}

// ---- As an app ----
// Installed from the browser it opens full screen and sideways on its own
// (the manifest). In a browser tab: an Install button where the browser
// offers one, the steps for Add to Home Screen on an iPhone or iPad, and a
// Full screen button that also turns it sideways where the phone allows.
const isApp = () => typeof window !== 'undefined' && (
  window.matchMedia('(display-mode: fullscreen)').matches
  || window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true);
const isIos = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const lockSideways = () => { try { window.screen?.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not allowed here */ } };

function useAppShell() {
  const [app, setApp] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const [ios, setIos] = useState(false);
  const [full, setFull] = useState(false);
  const [canFull, setCanFull] = useState(false);

  useEffect(() => {
    setApp(isApp());
    setIos(isIos());
    setCanFull(!!document.documentElement?.requestFullscreen);
    if (isApp()) lockSideways();
    // Kept on the device (public/checkin-sw.js) - not while developing, where
    // every file changes on each save.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/checkin-sw.js', { scope: '/rfid-chekin-display' }).catch(() => {});
    }
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => { setInstallEvt(null); setApp(true); };
    const onFull = () => { setFull(!!document.fullscreenElement); if (document.fullscreenElement) lockSideways(); };
    const mode = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
    const onMode = () => setApp(isApp());
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    document.addEventListener('fullscreenchange', onFull);
    mode.addEventListener?.('change', onMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      document.removeEventListener('fullscreenchange', onFull);
      mode.removeEventListener?.('change', onMode);
    };
  }, []);

  const install = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    setInstallEvt(null);
  };
  const goFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { /* not allowed here (an iPhone): Add to Home Screen is the way */ }
  };
  return { app, installEvt, ios, full, install, goFull, canFull };
}

function AppBar({ shell }) {
  const [iosHelp, setIosHelp] = useState(false);
  if (shell.app) return null;
  return (
    <div className="rcd-appbar">
      {shell.installEvt && (
        <button type="button" onClick={shell.install}><i className="fas fa-download"></i> Install app</button>
      )}
      {!shell.installEvt && shell.ios && (
        <button type="button" onClick={() => setIosHelp((v) => !v)} aria-expanded={iosHelp}>
          <i className="fas fa-square-plus"></i> Add to Home Screen
        </button>
      )}
      {shell.canFull && (
        <button type="button" onClick={shell.goFull}>
          <i className={`fas ${shell.full ? 'fa-compress' : 'fa-expand'}`}></i> {shell.full ? 'Exit full screen' : 'Full screen'}
        </button>
      )}
      {iosHelp && (
        <p className="rcd-ioshelp">
          Tap <i className="fas fa-arrow-up-from-bracket"></i> <b>Share</b>, then <b>Add to Home Screen</b>.
          Open <b>Check-in</b> from the home screen - it fills the screen like an app.
        </p>
      )}
    </div>
  );
}

export default function CheckinDisplayPage() {
  const shell = useAppShell();
  const [msg, setMsg] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [tap, setTap] = useState(null);
  const holdTimer = useRef(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => subscribeCheckinDisplay(setMsg, setStatus), []);

  // The latest tap, until HOLD_MS of quiet sends the card back to blank.
  useEffect(() => {
    const t = msg?.tap && Date.now() - msg.at < HOLD_MS ? msg.tap : null;
    setTap(t);
    clearTimeout(holdTimer.current);
    if (t) holdTimer.current = setTimeout(() => setTap(null), HOLD_MS);
    return () => clearTimeout(holdTimer.current);
  }, [msg]);

  // The clock in the corner of the welcome.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // A screen that dims mid-queue hides the names; keep it awake.
  useEffect(() => {
    if (!navigator.wakeLock) return undefined;
    let lock = null;
    const grab = () => {
      if (document.hidden) return;
      navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => { document.removeEventListener('visibilitychange', grab); lock?.release().catch(() => {}); };
  }, []);

  const event = msg?.event || {};
  const poster = isPosterUrl(event.image) ? event.image : '';
  const day = Number(msg?.day?.number) || 1;
  const days = Number(msg?.day?.days) || 1;
  const dayLabel = msg?.day?.label && msg.day.label !== `Day ${day}` ? msg.day.label : '';
  const dayDate = msg?.day?.date ? fmtDay(msg.day.date, { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const dates = datesOf(event.start, event.end);
  const venue = [event.venue, event.city && event.city !== event.venue ? event.city : ''].filter(Boolean).join(' · ');

  // Who the card shows: the attendee tapped, the blank ID for a card nobody
  // holds, nothing new while a card is still being read.
  const names = tap ? idNames(tap) : null;
  const reading = tap && !names && (tap.status === 'reading' || tap.status === 'checking');
  const who = !tap ? { key: 'idle', names: null, idle: true }
    : names ? { key: `p-${tap.seq}`, names }
      : reading ? null
        : { key: `b-${tap.seq}`, names: null };
  const d = tap ? describe(tap, day, days) : null;

  return (
    <main className="rcd">
      <div
        className={`rcd-bg ${poster ? '' : 'is-plain'}`}
        style={poster ? { backgroundImage: `url("${eventImageUrl(poster, 1280)}")` } : undefined}
        aria-hidden="true"
      />
      <div className="rcd-shade" aria-hidden="true" />

      {/* ---- Left: the welcome ---- */}
      <section className="rcd-welcome">
        <div className="rcd-brand">
          <img src="/assets/LOGO.png" alt="" />
          <span>Joyful Sound Church<small>International</small></span>
        </div>

        <h1 className="rcd-hello">
          <span>Welcome</span>
          <span>Delegates</span>
        </h1>

        <div className="rcd-event">
          {poster && <img className="rcd-poster" src={eventImageUrl(poster, 320)} alt="" />}
          <div>
            <h2>{event.title || 'Welcome to the event'}</h2>
            <ul className="rcd-facts">
              {dates && <li><i className="fas fa-calendar-days"></i> {dates}</li>}
              {venue && <li><i className="fas fa-location-dot"></i> {venue}</li>}
            </ul>
          </div>
        </div>

        {(days > 1 || dayDate) && (
          <p className="rcd-day">
            <i className="fas fa-id-card"></i>
            <span>
              Check-in{days > 1 ? ` · Day ${day}` : ''}{dayLabel ? ` · ${dayLabel}` : ''}
              {dayDate && <small>{dayDate}</small>}
            </span>
          </p>
        )}

        <p className="rcd-clock" aria-hidden="true">
          {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}
        </p>
      </section>

      {/* ---- Right: the ID ---- */}
      <section className="rcd-idside" aria-live="polite">
        <FlipId who={who} />
        <div className={`rcd-say ${d ? `is-${d.tone}` : 'is-idle'}`} key={tap ? `${tap.seq}-${tap.status}` : 'idle'}>
          {d ? (
            <>
              <b><i className={`fas ${d.busy ? 'fa-spinner fa-spin' : d.icon}`}></i> {d.headline}</b>
              {d.note && <span>{d.note}</span>}
            </>
          ) : (
            <>
              <b><i className="fas fa-wifi rcd-wifi"></i> Tap your ID card</b>
              <span>Hold it on the reader - your ID turns over with your name.</span>
            </>
          )}
        </div>
      </section>

      <div className={`rcd-status is-${status}`} role="status">
        <span className="rcd-dot" aria-hidden="true"></span>
        {STATUS_LABEL[status] || status}
      </div>

      <AppBar shell={shell} />

      {/* Sideways only: a phone or tablet held upright is asked to turn. */}
      <div className="rcd-rotate" aria-hidden="true">
        <span className="rcd-rotate-ico"><i className="fas fa-mobile-screen-button"></i></span>
        <b>Turn your device sideways</b>
        <span>The check-in screen is made for landscape.</span>
      </div>
    </main>
  );
}
