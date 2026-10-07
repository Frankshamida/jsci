'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeQrDisplay } from '@/lib/qrDisplay';
import './qrDisplay.css';

// What the attendee sees while paying online at the verification desk: the
// QR to scan and who it goes to. Open it on a tablet or in a second window
// turned towards the attendee; the desk fills it when an online method is
// picked, live, on any device.
//
// Behind it all, the event's poster, blurred. Idle, it greets the room -
// WELCOME DELEGATES; when the desk puts a QR up, the QR pops up over the same
// backdrop. The event is the one the desk is on (it says so when it opens);
// a screen that has not heard from a desk yet shows the last one it knew, or
// the event on today.

// An account's QR can change; a screen left up all day looks again this often.
const METHODS_STALE_MS = 2 * 60 * 1000;
// The event whose poster this screen last showed, so a reload keeps it.
const EVENT_KEY = 'jsci.qrDisplay.event';

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

export default function QrDisplayPage() {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [methods, setMethods] = useState(null);
  const [eventId, setEventId] = useState('');
  const [poster, setPoster] = useState(null); // { id, title, image }
  const [posterReady, setPosterReady] = useState(false);
  const fetchedAt = useRef(0);
  const triedFor = useRef('');

  useEffect(() => subscribeQrDisplay(setQr, setStatus, setEventId), []);

  // ---- The backdrop ----
  // The desk's event, else the one this screen last showed, else today's.
  const loadPoster = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/events/poster${id ? `?id=${encodeURIComponent(id)}` : ''}`);
      const data = await res.json();
      if (!data.success) {
        // A remembered event that is gone or unpublished: today's instead.
        if (id) loadPoster('');
        return;
      }
      setPoster(data.data);
      try { localStorage.setItem(EVENT_KEY, data.data.id); } catch { /* private window */ }
    } catch { /* the gold backdrop stays */ }
  }, []);
  useEffect(() => {
    if (eventId) { loadPoster(eventId); return; }
    let saved = '';
    try { saved = localStorage.getItem(EVENT_KEY) || ''; } catch { /* private window */ }
    loadPoster(saved);
  }, [eventId, loadPoster]);
  // Faded in once the picture has actually arrived, never half-drawn.
  useEffect(() => {
    setPosterReady(false);
    if (!poster?.image) return undefined;
    const img = new Image();
    img.onload = () => setPosterReady(true);
    img.src = poster.image;
    return () => { img.onload = null; };
  }, [poster?.image]);

  // The QR and the account come from the church's own list, never the message.
  const loadMethods = useCallback(async (fresh) => {
    try {
      const res = await fetch(`/api/payment-methods${fresh ? `?fresh=${Date.now()}` : ''}`);
      const data = await res.json();
      if (data.success) { setMethods(data.data || []); fetchedAt.current = Date.now(); }
    } catch { /* tried again with the next payment */ }
  }, []);
  useEffect(() => { loadMethods(false); }, [loadMethods]);
  useEffect(() => {
    if (!qr?.methodId || !methods) return;
    const miss = !methods.some((x) => x.id === qr.methodId);
    const stale = Date.now() - fetchedAt.current > METHODS_STALE_MS;
    if ((miss && triedFor.current !== qr.methodId) || stale) {
      triedFor.current = qr.methodId;
      loadMethods(true);
    }
  }, [qr, methods, loadMethods]);

  // A tablet that dims mid-payment hides the QR; keep it awake.
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

  const m = qr?.methodId ? methods?.find((x) => x.id === qr.methodId) : null;
  const waiting = qr?.methodId && !m && (!methods || triedFor.current !== qr.methodId);
  const initials = String(m?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <main className={`qrd ${posterReady ? 'has-poster' : ''}`}>
      {/* The event's poster, blurred, behind everything. */}
      <div
        className="qrd-bg"
        style={posterReady ? { backgroundImage: `url("${poster.image}")` } : undefined}
        aria-hidden="true"
      ></div>
      <div className="qrd-shade" aria-hidden="true"></div>

      {!m ? (
        <div className="qrd-idle" key="idle">
          <h1 className="qrd-welcome">
            <span className="qrd-welcome-1">Welcome</span>
            <span className="qrd-welcome-2">Delegates</span>
          </h1>
          {poster?.title && <p className="qrd-event">{poster.title}</p>}
          {qr?.methodId && (
            <p className="qrd-idle-note">
              {waiting ? 'Getting the payment details…' : 'Please ask the verifier where to send your payment.'}
            </p>
          )}
        </div>
      ) : (
        <div className="qrd-card" key={`${m.id}-${qr.amount}-${(qr.names || []).join('|')}`}>
          <div className="qrd-head">
            {m.logo_url
              ? <img className="qrd-logo" src={m.logo_url} alt="" />
              : <span className="qrd-logo qrd-logo-ph" style={{ background: m.logo_color || '#926c15' }}>{initials}</span>}
            <div>
              <small>Scan to pay with</small>
              <h1>{m.name}</h1>
            </div>
          </div>

          {m.qr_url
            ? <img className="qrd-qr" src={m.qr_url} alt={`${m.name} QR code`} />
            : <div className="qrd-qr qrd-qr-none">No QR code uploaded for {m.name}.<br />Send to the account below.</div>}

          <dl className="qrd-facts">
            {m.account_name && <div><dt>Account name</dt><dd>{m.account_name}</dd></div>}
            {m.account_number && <div><dt>Account number</dt><dd className="mono">{m.account_number}</dd></div>}
          </dl>

          {Number(qr.amount) > 0 && (
            <div className="qrd-amount">
              <span>Amount to pay</span>
              <b>₱{Number(qr.amount).toLocaleString()}</b>
              {qr.names?.length > 0 && <em>for {qr.names.join(', ')}</em>}
            </div>
          )}
          {m.notes && <p className="qrd-notes">{m.notes}</p>}
          <p className="qrd-foot">After paying, show the reference number to the verifier.</p>
        </div>
      )}

      <div className={`qrd-status is-${status}`} role="status">
        <span className="qrd-dot" aria-hidden="true"></span>
        {STATUS_LABEL[status] || status}
      </div>
    </main>
  );
}
