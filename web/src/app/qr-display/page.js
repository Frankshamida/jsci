'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  followQrDesk, isDeskCode, normaliseDeskCode, rememberScreenDeskCode, screenDeskCode,
} from '@/lib/qrDisplay';
import './qrDisplay.css';

// What the attendee sees while paying online at the verification desk: the
// QR to scan and who it goes to. Open it on a tablet (or a second window)
// turned towards the attendee and enter the desk's code once; the desk fills
// it when an online method is picked.

// An account's QR can change; a screen left up all day looks again this often.
const METHODS_STALE_MS = 2 * 60 * 1000;

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

export default function QrDisplayPage() {
  const [code, setCode] = useState(null); // null until read, '' when not paired
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [methods, setMethods] = useState(null);
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState('');
  const fetchedAt = useRef(0);
  const triedFor = useRef('');

  useEffect(() => { setCode(screenDeskCode()); }, []);

  useEffect(() => {
    if (!code) return undefined;
    setQr(null);
    return followQrDesk(code, setQr, setStatus);
  }, [code]);

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

  // A tablet that dims mid-payment hides the QR; keep it awake while paired.
  useEffect(() => {
    if (!code || !navigator.wakeLock) return undefined;
    let lock = null;
    const grab = () => {
      if (document.hidden) return;
      navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => { document.removeEventListener('visibilitychange', grab); lock?.release().catch(() => {}); };
  }, [code]);

  const setUrlDesk = (value) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('desk', value); else url.searchParams.delete('desk');
    window.history.replaceState(null, '', url);
  };
  const connect = (e) => {
    e.preventDefault();
    const value = normaliseDeskCode(entry);
    if (!isDeskCode(value)) { setEntryError('Enter the 6-character code shown at the desk.'); return; }
    rememberScreenDeskCode(value);
    setUrlDesk(value);
    setEntryError('');
    setCode(value);
  };
  const unpair = () => {
    rememberScreenDeskCode('');
    setUrlDesk('');
    setEntry('');
    setQr(null);
    setCode('');
  };

  if (code === null) return <main className="qrd" />;

  if (!code) {
    return (
      <main className="qrd">
        <form className="qrd-card qrd-pair" onSubmit={connect}>
          <div className="qrd-pair-ring"><i className="fas fa-display" aria-hidden="true"></i></div>
          <h1>Connect to a desk</h1>
          <p>On the verification desk, open Online Payment and find the desk code beside <b>QR screen</b>.</p>
          <input
            className="qrd-pair-input"
            value={entry}
            onChange={(e) => { setEntry(normaliseDeskCode(e.target.value)); setEntryError(''); }}
            placeholder="ABC123"
            aria-label="Desk code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            autoFocus
          />
          {entryError && <p className="qrd-pair-error">{entryError}</p>}
          <button type="submit" className="qrd-pair-btn" disabled={entry.length < 6}>Connect</button>
        </form>
      </main>
    );
  }

  const m = qr?.methodId ? methods?.find((x) => x.id === qr.methodId) : null;
  const waiting = qr?.methodId && !m && (!methods || triedFor.current !== qr.methodId);
  const initials = String(m?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <main className="qrd">
      {!m ? (
        <div className="qrd-idle" key="idle">
          <div className="qrd-idle-ring"><span>₱</span></div>
          <h1>Welcome!</h1>
          <p>
            {!qr?.methodId && 'The payment QR code will appear here.'}
            {qr?.methodId && (waiting ? 'Getting the payment details…' : 'Please ask the verifier where to send your payment.')}
          </p>
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
        {STATUS_LABEL[status] || status} · Desk {code}
        {!qr && <button type="button" onClick={unpair}>Change</button>}
      </div>
    </main>
  );
}
