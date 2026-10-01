'use client';

import { useEffect, useState } from 'react';
import { readQrDisplay, subscribeQrDisplay } from '@/lib/qrDisplay';
import './qrDisplay.css';

// What the attendee sees while paying online at the verification desk: the
// QR to scan and who it goes to. Open it in a second window turned towards
// the attendee; the desk fills it when an online method is picked.
export default function QrDisplayPage() {
  const [state, setState] = useState(null);

  useEffect(() => {
    setState(readQrDisplay());
    return subscribeQrDisplay(setState);
  }, []);

  const m = state?.method;
  const initials = String(m?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <main className="qrd">
      {!m ? (
        <div className="qrd-idle" key="idle">
          <div className="qrd-idle-ring"><span>₱</span></div>
          <h1>Welcome!</h1>
          <p>The payment QR code will appear here.</p>
        </div>
      ) : (
        <div className="qrd-card" key={`${m.id || m.name}-${state.at}`}>
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

          {Number(state.amount) > 0 && (
            <div className="qrd-amount">
              <span>Amount to pay</span>
              <b>₱{Number(state.amount).toLocaleString()}</b>
              {state.names?.length > 0 && <em>for {state.names.join(', ')}</em>}
            </div>
          )}
          {m.notes && <p className="qrd-notes">{m.notes}</p>}
          <p className="qrd-foot">After paying, show the reference number to the verifier.</p>
        </div>
      )}
    </main>
  );
}
