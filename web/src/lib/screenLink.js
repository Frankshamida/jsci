// A desk driving a screen turned towards the attendees: the payment QR
// (/qr-display), the name at the Meals Counter (/rfid-meals-display).
//
// Two roads carry what the desk publishes. In the same browser (a second
// window or monitor) a BroadcastChannel delivers it instantly, offline
// included. On another device (a tablet, a TV on a laptop) it goes through a
// Supabase Realtime broadcast channel. A screen that opens, wakes or
// reconnects says hello, and the desk answers with what is up.
//
// Every message carries the desk's own clock (at), and a screen only ever
// shows the newest it has seen - both roads can deliver the same message, and
// a hello's answer can land after something newer.

import { supabase } from '@/lib/supabase';

/**
 * @param {object} o
 * @param {string} o.channel     BroadcastChannel name (same browser)
 * @param {string} o.storageKey  localStorage key holding the last message
 * @param {string} o.topic       Realtime topic (other devices)
 * @param {(msg: object) => boolean} [o.answersHello]  whether the desk answers
 *        a hello with this message - an idle desk need not blank a screen
 *        another desk is using
 */
export function createScreenLink({ channel, storageKey, topic, answersHello = (msg) => !!msg }) {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  };

  // ---- The desk ----
  let deskCh = null;
  const deskChannel = () => {
    if (!supabase) return null;
    if (deskCh) return deskCh;
    deskCh = supabase.channel(topic, { config: { broadcast: { self: false } } });
    deskCh.on('broadcast', { event: 'hello' }, () => {
      const msg = read();
      if (msg && answersHello(msg)) sendRemote(msg);
    });
    deskCh.subscribe();
    return deskCh;
  };
  const sendRemote = (msg) => {
    const ch = deskChannel();
    if (!ch) return;
    const payload = { msg };
    // Until the socket has joined, the REST endpoint carries it.
    if (ch.state === 'joined') ch.send({ type: 'broadcast', event: 'show', payload }).catch(() => {});
    else ch.httpSend('show', payload).catch(() => {});
  };

  /** Publishes { ...content, at }. remote: false keeps it to this browser. */
  const publish = (content, { remote = true } = {}) => {
    const msg = { ...content, at: Date.now() };
    try { localStorage.setItem(storageKey, JSON.stringify(msg)); } catch { /* private window */ }
    try {
      const bc = new BroadcastChannel(channel);
      bc.postMessage(msg);
      bc.close();
    } catch { /* old browser: the storage event still reaches a screen here */ }
    if (remote) sendRemote(msg);
    return msg;
  };

  // ---- The screen ----
  // One channel, kept a moment after its last listener goes: the client hands
  // back a leaving channel for the same topic, so leaving and rejoining at
  // once (a remount) would try to subscribe it twice.
  let room = null;
  const joinRoom = () => {
    if (room) return room;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    const r = { ch, listeners: new Set(), status: 'connecting', last: null, closing: null };
    r.hello = () => {
      if (ch.state === 'joined') ch.send({ type: 'broadcast', event: 'hello', payload: {} }).catch(() => {});
    };
    const setStatus = (s) => { r.status = s; r.listeners.forEach((l) => l.onStatus(s)); };
    ch.on('broadcast', { event: 'show' }, ({ payload }) => {
      const msg = payload?.msg;
      if (msg && typeof msg.at === 'number' && msg.at >= (r.last?.at || 0)) r.last = msg;
      r.listeners.forEach((l) => l.take(msg));
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') { setStatus('live'); r.hello(); }
      else if (status === 'CLOSED') setStatus('offline');
      else setStatus('connecting'); // CHANNEL_ERROR / TIMED_OUT: the client rejoins by itself
    });
    // A tablet that slept may have missed a change; ask again on waking.
    r.onVisible = () => { if (!document.hidden) r.hello(); };
    document.addEventListener('visibilitychange', r.onVisible);
    window.addEventListener('online', r.hello);
    room = r;
    return r;
  };
  const leaveRoom = () => {
    if (!room || room.listeners.size) return;
    const r = room;
    room = null;
    document.removeEventListener('visibilitychange', r.onVisible);
    window.removeEventListener('online', r.hello);
    supabase.removeChannel(r.ch);
  };

  /**
   * onChange(msg) gets each newer message; onStatus(status) gets 'live',
   * 'connecting' or 'offline'. Returns an unsubscribe.
   */
  const subscribe = (onChange, onStatus = () => {}) => {
    const stops = [];
    // Newest per publisher (msg.from): a desk and a screen scanning for itself
    // can both be publishing, each on its own device's clock, and one running
    // a few seconds behind must not have every message thrown away.
    const lastAt = new Map();
    const take = (msg) => {
      if (!msg || typeof msg.at !== 'number') return;
      const from = msg.from || '';
      if (msg.at < (lastAt.get(from) || 0)) return;
      lastAt.set(from, msg.at);
      onChange(msg);
    };

    // The same browser as the desk: instant, and works without a connection.
    take(read());
    try {
      const bc = new BroadcastChannel(channel);
      bc.onmessage = (e) => take(e.data);
      stops.push(() => bc.close());
    } catch { /* storage events below */ }
    const onStorage = (e) => { if (e.key === storageKey) take(read()); };
    window.addEventListener('storage', onStorage);
    stops.push(() => window.removeEventListener('storage', onStorage));

    if (supabase) {
      const r = joinRoom();
      const listener = { take, onStatus };
      r.listeners.add(listener);
      clearTimeout(r.closing);
      onStatus(r.status);
      take(r.last);
      r.hello();
      stops.push(() => {
        r.listeners.delete(listener);
        if (!r.listeners.size) r.closing = setTimeout(leaveRoom, 5000);
      });
    } else {
      onStatus('offline');
    }

    return () => stops.forEach((stop) => stop());
  };

  return { read, publish, subscribe };
}
