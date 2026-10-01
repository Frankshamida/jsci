// The attendee-facing QR screen (/qr-display), driven by the verification
// desk. The desk publishes what to show; the screen listens.
//
// Two roads carry it. In the same browser (a second window or monitor) a
// BroadcastChannel delivers it instantly, offline included. On another device
// (a tablet turned towards the attendee) it goes through a Supabase Realtime
// broadcast channel named after the desk's code - six characters this device
// keeps, which the screen is told once and remembers. A screen that joins (or
// reconnects) mid-payment says hello and the desk answers with what is on.
//
// Only the channel's id crosses the network. The screen looks the QR and the
// account up in the public payment methods itself, so whoever learns a desk
// code can at most pick one of the church's own accounts - never put up a QR
// of their own.

import { supabase } from '@/lib/supabase';

const CHANNEL = 'jsci-qr-display';
const KEY = 'jsci.qrDisplay.v2';
const DESK_KEY = 'jsci.qrDisplay.desk';
const SCREEN_KEY = 'jsci.qrDisplay.screen';

// No 0/O or 1/I: the code is read off one screen and typed into another.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export const normaliseDeskCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const isDeskCode = (s) => CODE_RE.test(String(s || ''));
const topicOf = (code) => `qr-display-${code}`;

function newCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const readKey = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeKey = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

let sessionCode = null; // when localStorage is blocked, the code lasts the session
/** This device's desk code, made the first time it is asked for. */
export function deskCode() {
  if (typeof window === 'undefined') return '';
  const saved = readKey(DESK_KEY);
  if (isDeskCode(saved)) return saved;
  const code = sessionCode || newCode();
  sessionCode = code;
  writeKey(DESK_KEY, code);
  return code;
}

/** The desk a screen follows: the link it was opened with, else the last one. */
export function screenDeskCode() {
  const fromUrl = normaliseDeskCode(new URLSearchParams(window.location.search).get('desk'));
  if (isDeskCode(fromUrl)) { writeKey(SCREEN_KEY, fromUrl); return fromUrl; }
  const saved = readKey(SCREEN_KEY);
  if (isDeskCode(saved)) return saved;
  // The desk's own browser, opened without a code: follow this desk.
  const own = readKey(DESK_KEY);
  return isDeskCode(own) ? own : '';
}

export function rememberScreenDeskCode(code) {
  if (isDeskCode(code)) writeKey(SCREEN_KEY, code);
  else { try { localStorage.removeItem(SCREEN_KEY); } catch { /* private window */ } }
}

export function readQrDisplay() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

// ---- The desk ----

let desk = null; // { code, ch }

function deskChannel() {
  if (!supabase) return null;
  const code = deskCode();
  if (desk?.code === code) return desk.ch;
  const ch = supabase.channel(topicOf(code), { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'hello' }, () => sendRemote(readQrDisplay()));
  ch.subscribe();
  desk = { code, ch };
  return ch;
}

function sendRemote(msg) {
  const ch = deskChannel();
  if (!ch) return;
  const payload = { msg };
  // Until the socket has joined, the REST endpoint carries it.
  if (ch.state === 'joined') ch.send({ type: 'broadcast', event: 'show', payload }).catch(() => {});
  else ch.httpSend('show', payload).catch(() => {});
}

/**
 * Show a payment channel to the attendee, or clear the screen with null.
 * @param {null | { methodId: string, amount: number, names: string[] }} qr
 */
export function publishQrDisplay(qr) {
  const wasShowing = !!readQrDisplay()?.qr;
  const msg = { at: Date.now(), qr: qr || null };
  writeKey(KEY, JSON.stringify(msg));
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch { /* old browser: the storage event still reaches a screen here */ }
  // The dashboard clears the screen every time it loads; another device only
  // needs telling when something is, or was, on it.
  if (qr || wasShowing) sendRemote(msg);
}

// ---- The screen ----

/**
 * Follows the desk with this code. onChange(qr) gets what to show (or null);
 * onStatus(status) gets 'live', 'connecting' or 'offline'. Returns an unsubscribe.
 */
export function followQrDesk(code, onChange, onStatus = () => {}) {
  const stops = [];
  let lastAt = 0;
  // Both roads can deliver the same message, and a hello's answer can land
  // after something newer - only the latest the desk sent is shown.
  const take = (msg) => {
    if (!msg || typeof msg.at !== 'number' || msg.at < lastAt) return;
    lastAt = msg.at;
    onChange(msg.qr || null);
  };

  // The same browser as the desk: instant, and works without a connection.
  if (code && code === readKey(DESK_KEY)) {
    take(readQrDisplay());
    try {
      const bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e) => take(e.data);
      stops.push(() => bc.close());
    } catch { /* storage events below */ }
    const onStorage = (e) => { if (e.key === KEY) take(readQrDisplay()); };
    window.addEventListener('storage', onStorage);
    stops.push(() => window.removeEventListener('storage', onStorage));
  }

  if (supabase && isDeskCode(code)) {
    const room = joinDeskRoom(code);
    const listener = { take, onStatus };
    room.listeners.add(listener);
    clearTimeout(room.closing);
    onStatus(room.status);
    take(room.last);
    room.hello();
    stops.push(() => {
      room.listeners.delete(listener);
      if (!room.listeners.size) room.closing = setTimeout(() => leaveDeskRoom(code), 5000);
    });
  } else if (!supabase) {
    onStatus('offline');
  }

  return () => stops.forEach((stop) => stop());
}

// One channel per desk code, kept a moment after its last listener goes:
// the client hands back a leaving channel for the same topic, so leaving and
// rejoining at once (a remount) would try to subscribe it twice.
const rooms = new Map();

function joinDeskRoom(code) {
  if (rooms.has(code)) return rooms.get(code);
  const ch = supabase.channel(topicOf(code), { config: { broadcast: { self: false } } });
  const room = { ch, listeners: new Set(), status: 'connecting', last: null, closing: null };
  room.hello = () => {
    if (ch.state === 'joined') ch.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {});
  };
  const setStatus = (s) => { room.status = s; room.listeners.forEach((l) => l.onStatus(s)); };
  ch.on('broadcast', { event: 'show' }, ({ payload }) => {
    const msg = payload?.msg;
    if (msg && typeof msg.at === 'number' && msg.at >= (room.last?.at || 0)) room.last = msg;
    room.listeners.forEach((l) => l.take(msg));
  });
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') { setStatus('live'); room.hello(); }
    else if (status === 'CLOSED') setStatus('offline');
    else setStatus('connecting'); // CHANNEL_ERROR / TIMED_OUT: the client rejoins by itself
  });
  // A tablet that slept may have missed a change; ask again on waking.
  room.onVisible = () => { if (!document.hidden) room.hello(); };
  document.addEventListener('visibilitychange', room.onVisible);
  window.addEventListener('online', room.hello);
  rooms.set(code, room);
  return room;
}

function leaveDeskRoom(code) {
  const room = rooms.get(code);
  if (!room || room.listeners.size) return;
  rooms.delete(code);
  document.removeEventListener('visibilitychange', room.onVisible);
  window.removeEventListener('online', room.hello);
  supabase.removeChannel(room.ch);
}
