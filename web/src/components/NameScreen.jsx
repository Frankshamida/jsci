'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPersonName } from '@/lib/eventFormat';
import { drawIdFront, ID_ORIGINAL_SCALE } from '@/lib/idCard';

// The pieces the two name screens share - the door (/rfid-chekin-display) and
// the Meals Counter (/rfid-meals-display): the ID that turns over to whoever
// tapped, the Install / Full screen buttons, and keeping the screen awake.
// Styled by app/rfid-chekin-display/checkinDisplay.css (the .rcd-* classes).

// ---- Dates, the way the screens say them ----
export const TZ = 'Asia/Manila';
export const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '');
const dayKey = (iso) => String(iso || '').slice(0, 10);
export const fmtDay = (key, opts) => new Date(`${key}T12:00:00+08:00`).toLocaleDateString('en-US', { timeZone: TZ, ...opts });

// "October 8-9, 2026", "Sep 30 - Oct 2, 2026", "October 8, 2026".
export function datesOf(start, end) {
  const a = dayKey(start);
  const b = dayKey(end) || a;
  if (!a) return '';
  if (a === b) return fmtDay(a, { month: 'long', day: 'numeric', year: 'numeric' });
  if (a.slice(0, 7) === b.slice(0, 7)) return `${fmtDay(a, { month: 'long', day: 'numeric' })}-${fmtDay(b, { day: 'numeric' })}, ${b.slice(0, 4)}`;
  return `${fmtDay(a, { month: 'short', day: 'numeric' })} - ${fmtDay(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// The line on the left: who is still to come on the card, in tap order.
const UP_NEXT_SHOWN = 4;
export function UpNext({ waiting }) {
  return (
    <div className="rcd-line" aria-live="polite">
      <b className="rcd-line-head">
        <i className="fas fa-people-line"></i> Up next
        <span className="rcd-line-count">{waiting.length}</span>
      </b>
      <ol>
        {waiting.slice(0, UP_NEXT_SHOWN).map((t, i) => (
          <li key={t.id} className={i === 0 ? 'is-next' : ''}>
            <span className="rcd-line-num">{i + 1}</span>
            <span className={`rcd-line-name ${t.name ? '' : 'is-card'}`}>
              {t.name ? formatPersonName(t.name) : 'Reading a card…'}
            </span>
          </li>
        ))}
      </ol>
      {waiting.length > UP_NEXT_SHOWN && <span className="rcd-line-more">+ {waiting.length - UP_NEXT_SHOWN} more</span>}
    </div>
  );
}

// How long one turn of the card takes - matches .rcd-card's transition.
export const FLIP_MS = 950;
// The template's own resolution: as sharp as the printed ID, on any screen.
const SCALE = ID_ORIGINAL_SCALE;

// The name as the ID prints it: last name over first name. The registration's
// own two fields when the desk sent them; otherwise the full name, split at
// its last word.
export function idNames(tap) {
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
//
//   who  { key, names: {firstName, lastName} | null, idle? } - a new key
//        turns the card; null leaves it as it is.
export function FlipId({ who }) {
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

// ---- The line ----
// Every card tapped, from every publisher - the desk's dialog, this screen's
// own reader - turned into one line the ID works through in tap order. Each
// attendee gets their moment on the card even when the queue taps faster
// than one turn each, and the ones still to come are a list beside it.
//
//   isBusy(tap)   still being answered: the card waits on it a while
//   hold          how long the last ID stays up with nobody else tapping
//   dwell         each ID is up at least this long before the next...
//   dwellBusy     ...or this long with three or more waiting behind it
//
// feed(from, taps, at, { merge })  what one publisher has: its whole line
//   (replacing what it sent before), or with merge one tap at a time, added
//   to the ones before it (a desk that sends only the latest tap). at is the
//   publisher's clock when it sent them.
//
// Returns { tap, waiting, feed }: the tap on the card (null for the blank
// ID) and the taps still to come, in order.
const LINE_KEEP = 12;
const idOf = (from, tap) => `${from}|${tap.seq}`;

export function useTapLine(isBusy, { hold = 15000, dwell = 2600, dwellBusy = 1500 } = {}) {
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  // from -> Map(seq -> tap), and which publishers have been heard from at all
  const sources = useRef(new Map());
  const heard = useRef(new Set());
  // Ids taken into this screen's line (decided once, when first seen) and
  // ids already shown. A screen opened mid-lunch does not replay the last
  // hour, a name waiting behind a long line never runs out of time, and a
  // second device whose clock is a few seconds off is still shown.
  const admitted = useRef(new Set());
  const shown = useRef(new Set());
  // id on the card; what it last said; when it went up and last changed
  const play = useRef({ id: null, tap: null, since: 0, touched: 0 });
  const listRef = useRef([]);
  const [view, setView] = useState({ id: null, list: [] });

  const draw = () => setView({ id: play.current.id, list: listRef.current });

  const step = useCallback(() => {
    const p = play.current;
    const at = Date.now();
    const busy = (t) => busyRef.current(t);
    const list = listRef.current;
    const ahead = list.filter((t) => admitted.current.has(t.id) && !shown.current.has(t.id));
    const next = ahead[0];
    const show = (tap) => {
      shown.current.add(tap.id);
      play.current = { id: tap.id, tap, since: at, touched: at };
      draw();
    };

    if (p.id == null) { if (next) show(next); return; }
    const cur = list.find((t) => t.id === p.id) || p.tap;
    if (next) {
      const wait = ahead.length >= 3 ? dwellBusy : dwell;
      // Their moment is up, and the desk has finished with them - or has
      // already moved on to the next card, or has been stuck on them a while.
      if (at - p.since >= wait && (!busy(cur) || next.status !== 'waiting' || at - p.touched >= hold)) show(next);
      return;
    }
    if (at - p.touched >= (busy(cur) ? hold * 2 : hold)) {
      play.current = { id: null, tap: null, since: 0, touched: 0 };
      draw();
    }
  }, [hold, dwell, dwellBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  const feed = useCallback((from, taps, at, { merge = false } = {}) => {
    const sent = (Array.isArray(taps) ? taps : []).filter((t) => t && t.seq);
    const had = sources.current.get(from) || new Map();
    const mine = merge ? new Map(had) : new Map();
    sent.forEach((t) => mine.set(t.seq, t));
    if (mine.size > LINE_KEEP) {
      [...mine.keys()].sort((a, b) => a - b).slice(0, mine.size - LINE_KEEP).forEach((k) => mine.delete(k));
    }
    sources.current.set(from, mine);

    // The first message from a publisher may be an old one kept on the
    // device; only a recent one counts. After that every message is live.
    const live = heard.current.has(from) || Date.now() - (at || 0) < hold;
    heard.current.add(from);
    sent.forEach((t) => {
      const id = idOf(from, t);
      if (admitted.current.has(id) || shown.current.has(id) || !live) return;
      if (busyRef.current(t) || (at || 0) - (t.t || t.seq) < hold) admitted.current.add(id);
    });

    const list = [];
    sources.current.forEach((m, src) => m.forEach((t) => list.push({ ...t, id: idOf(src, t) })));
    list.sort((a, b) => a.seq - b.seq);
    listRef.current = list;
    // Forget what is no longer on any line.
    const present = new Set(list.map((t) => t.id));
    admitted.current.forEach((id) => { if (!present.has(id)) admitted.current.delete(id); });
    shown.current.forEach((id) => { if (!present.has(id) && id !== play.current.id) shown.current.delete(id); });

    // The card's own news (served, already in) keeps it up another hold.
    const p = play.current;
    const cur = p.id != null && list.find((t) => t.id === p.id);
    if (cur && (cur.status !== p.tap?.status || cur.name !== p.tap?.name)) {
      play.current = { ...p, tap: cur, touched: Date.now() };
    }
    draw();
    step();
  }, [hold, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // The card moves on by the clock as well as by the publishers.
  useEffect(() => {
    const t = setInterval(step, 250);
    return () => clearInterval(t);
  }, [step]);

  const tap = view.id == null ? null : (view.list.find((t) => t.id === view.id) || play.current.tap);
  const waiting = view.list.filter((t) => admitted.current.has(t.id) && !shown.current.has(t.id));
  return { tap, waiting, feed };
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

/** worker: { url, scope } of the screen's own service worker, if it has one. */
export function useAppShell({ worker = null } = {}) {
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
    // Kept on the device - not while developing, where every file changes on
    // each save.
    if (worker && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register(worker.url, { scope: worker.scope }).catch(() => {});
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
  }, [worker?.url, worker?.scope]); // eslint-disable-line react-hooks/exhaustive-deps

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

/** appName: what the home-screen icon is called, for the iPhone steps. */
export function AppBar({ shell, appName }) {
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
          Open <b>{appName}</b> from the home screen - it fills the screen like an app.
        </p>
      )}
    </div>
  );
}

// A screen that dims mid-queue hides the names; keep it awake.
export function useWakeLock() {
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
}

// Sideways only: a phone or tablet held upright is asked to turn.
export function RotateHint({ what }) {
  return (
    <div className="rcd-rotate" aria-hidden="true">
      <span className="rcd-rotate-ico"><i className="fas fa-mobile-screen-button"></i></span>
      <b>Turn your device sideways</b>
      <span>{what} is made for landscape.</span>
    </div>
  );
}
