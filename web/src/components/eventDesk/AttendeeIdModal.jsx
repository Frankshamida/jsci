'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ID_ORIGINAL_SCALE, drawIdFront, drawIdBack, idQrText, canvasToBlob,
} from '@/lib/idCard';
import { downloadBlob, safeFilename } from '@/lib/exportDoc';
import { formatPersonName, formatChurchName } from '@/lib/eventFormat';

// Older rows were saved before first and last name were split out, so the two
// are recovered from the combined name when they are missing.
function splitName(reg) {
  const whole = String(reg?.attendee_name || '').trim().replace(/\s+/g, ' ');
  const first = reg?.attendee_firstname || whole.split(' ').slice(0, -1).join(' ') || whole;
  const last = reg?.attendee_lastname || (whole.includes(' ') ? whole.split(' ').slice(-1)[0] : '');
  return { first: formatPersonName(first), last: formatPersonName(last) };
}

// The preview is drawn at 4x and shown at up to 340 x 480, so it stays crisp
// on high-density screens without being a different drawing from the download.
const PREVIEW_SCALE = 4;

// The site the QR points at. The configured live domain when there is one, so
// an ID printed from a laptop on localhost still opens the real site.
const siteOrigin = () => (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : ''))
  .replace(/\/+$/, '');

const printedWhen = (iso) => new Date(iso).toLocaleString('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export default function AttendeeIdModal({ reg, eventTitle, eventSlug, actorId, onClose, onUpdated, showToast }) {
  const initial = splitName(reg);
  const [lastName, setLastName] = useState(initial.last);
  const [firstName, setFirstName] = useState(initial.first);
  const [qrLogo, setQrLogo] = useState(true);
  const [template, setTemplate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');
  const frontRef = useRef(null);
  const backRef = useRef(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const layout = await drawIdFront(frontRef.current, { lastName, firstName }, PREVIEW_SCALE);
        if (live) { setTemplate(layout.template); setError(''); }
      } catch (e) { if (live) setError(e.message); }
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [lastName, firstName]);

  // One QR for the whole event - the same on every attendee's ID.
  const qrText = idQrText({ origin: siteOrigin(), eventSlug });

  useEffect(() => {
    drawIdBack(backRef.current, { qrText, logo: qrLogo }, PREVIEW_SCALE).catch((e) => setError(e.message));
  }, [qrText, qrLogo]);

  const fileBase = safeFilename(lastName, firstName, 'ID');

  const download = async (which) => {
    setBusy(true);
    try {
      const sides = which === 'both' ? ['front', 'back'] : [which];
      for (const side of sides) {
        const full = document.createElement('canvas');
        if (side === 'front') await drawIdFront(full, { lastName, firstName }, ID_ORIGINAL_SCALE);
        else await drawIdBack(full, { qrText, logo: qrLogo }, ID_ORIGINAL_SCALE);
        // Always the template's original quality (1416 x 2000).
        const blob = await canvasToBlob(full);
        downloadBlob(blob, `${fileBase}-${side === 'front' ? 'Front' : 'Back'}.png`);
        // Two downloads in the same tick are often merged or blocked.
        if (sides.length > 1) await new Promise((r) => setTimeout(r, 400));
      }
      showToast?.(which === 'both' ? 'Front and back downloaded' : `${which === 'front' ? 'Front' : 'Back'} downloaded`, 'success');
    } catch (e) {
      showToast?.(`Could not make the ID: ${e.message}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const printedAt = reg.id_printed_at;
  const togglePrinted = async () => {
    setMarking(true);
    try {
      const res = await fetch('/api/events/registrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reg.id, actorId, action: 'id_printed', printed: !printedAt }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Could not save');
      onUpdated?.(data.data);
      showToast?.(data.message, 'success');
    } catch (e) {
      showToast?.(e.message, 'danger');
    } finally {
      setMarking(false);
    }
  };

  const unverified = !['payment_verified', 'registered', 'paid_pending_turnover'].includes(reg.status);

  return (
    <div className="evt-modal-overlay evt-id-overlay" onClick={() => !busy && onClose()}>
      <div className="evt-modal evt-id-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="evt-modal-head">
          <div><h3>Attendee ID</h3><p>{eventTitle || formatPersonName(reg.attendee_name)}</p></div>
          <button className="evt-modal-close" onClick={onClose} disabled={busy}><i className="fas fa-times"></i></button>
        </div>
        <div className="evt-modal-body evt-id-layout">
          {/* Left: what goes on the card and how to get it. */}
          <div className="evt-id-side">
            {/* Only what goes on the card - the registration itself is not changed. */}
            <div className="evt-id-names">
              <div className="form-group">
                <label>Last Name</label>
                <input className="form-control" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
              </div>
              <div className="form-group">
                <label>First Name</label>
                <input className="form-control" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
              </div>
            </div>

            <button
              type="button"
              className={`evt-id-logo-toggle${qrLogo ? ' is-on' : ''}`}
              onClick={() => setQrLogo((v) => !v)}
              disabled={busy}
              aria-pressed={qrLogo}
            >
              <span><i className="fas fa-qrcode"></i> Logo in QR</span>
              <i className={`fas ${qrLogo ? 'fa-toggle-on' : 'fa-toggle-off'} evt-id-switch`}></i>
            </button>

            {/* What this card is for - fills the room between the fields and the buttons. */}
            <dl className="evt-id-info">
              <div><dt><i className="fas fa-user"></i> Attendee</dt><dd>{formatPersonName(reg.attendee_name) || '—'}</dd></div>
              {reg.price_tier && <div><dt><i className="fas fa-tag"></i> Type</dt><dd>{reg.price_tier}</dd></div>}
              {reg.church_name && <div><dt><i className="fas fa-church"></i> Church</dt><dd>{formatChurchName(reg.church_name)}</dd></div>}
              <div>
                <dt><i className="fas fa-print"></i> ID</dt>
                <dd className={printedAt ? 'is-printed' : ''}>{printedAt ? `Printed ${printedWhen(printedAt)}` : 'Not printed yet'}</dd>
              </div>
            </dl>

            {error && <p className="evt-field-error-msg">{error}</p>}
            {unverified && (
              <p className="evt-call-warn">
                <i className="fas fa-circle-info"></i> Not paid yet. The QR only lets them in once the payment is verified.
              </p>
            )}

            <div className="evt-id-actions">
              <button className="btn-secondary" onClick={() => download('front')} disabled={busy}>
                <i className="fas fa-id-card"></i> Front
              </button>
              <button className="btn-secondary" onClick={() => download('back')} disabled={busy}>
                <i className="fas fa-qrcode"></i> Back
              </button>
              <button className="btn-primary evt-id-both" onClick={() => download('both')} disabled={busy}>
                <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-download'}`}></i> {busy ? 'Preparing…' : 'Download Both'}
              </button>
              <button
                type="button"
                className={`evt-id-printed${printedAt ? ' is-printed' : ''}`}
                onClick={togglePrinted}
                disabled={marking || busy}
                title={printedAt ? 'Click to unmark' : 'Mark this ID as printed'}
              >
                <i className={`fas ${marking ? 'fa-spinner fa-spin' : printedAt ? 'fa-circle-check' : 'fa-print'}`}></i>
                {printedAt ? 'Printed' : 'Mark as Printed'}
              </button>
              {printedAt && <p className="evt-id-printed-when">Click again to unmark</p>}
            </div>
          </div>

          {/* Right: the preview. */}
          <div className="evt-id-preview">
            <figure>
              <canvas ref={frontRef} className="evt-id-canvas" aria-label="Front of the ID" />
              <figcaption>Front{template ? ` · Template ${template}` : ''}</figcaption>
            </figure>
            <figure>
              <canvas ref={backRef} className="evt-id-canvas" aria-label="Back of the ID" />
              <figcaption>Back · event QR (same for all)</figcaption>
            </figure>
          </div>
        </div>
      </div>
    </div>
  );
}
