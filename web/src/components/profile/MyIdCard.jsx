'use client';

// My Profile > My ID: the person's church ID, front and back, from the
// church's own templates (public/user-id-template). Tap the card to turn it
// over. One toolbar under it: Show back, QR code, Download, Print; "Report
// lost card" beside it. Card details come from /api/profile/id-card.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ID_CARD_TITLE, fillIdCard, scopeSvgIds } from '@/lib/churchIdCard';
import { loadIdTemplate, qrDataUrl, downloadIdPng, printId } from './churchIdExport';
import './profile.css';

// "Jeremiah 29:11 - For I know…" or just "Jeremiah 29:11".
function splitVerse(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(' - ');
  return i > 0 ? { ref: s.slice(0, i).trim(), text: s.slice(i + 3).trim() } : { ref: '', text: s };
}

/** What fillIdCard needs, from the card details and the page. */
export function buildIdFill({ card, theme = 'light', qr = '', photo, verseText, verseRef, overrides = {} }) {
  if (!card) return null;
  const own = splitVerse(card.life_verse);
  return {
    theme,
    ministry: card.ministry,
    full_name: card.full_name,
    position: card.position || '',
    ministry_head: card.ministry_head || '',
    pastoral_title: card.pastoral_title || '',
    oversees: card.oversees || '',
    id_no: card.id_no || '',
    valid_until: card.valid_until || '',
    issued_date: card.issued_date || '',
    emergency_name: card.emergency_name || '',
    emergency_phone: card.emergency_phone || '',
    photo: photo ?? card.photo ?? '',
    qr_code: qr,
    qr_value: card.qr_value,
    life_verse: verseText || own.text || '',
    life_verse_ref: verseRef || own.ref || '',
    ...overrides,
  };
}

export function useQr(value) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let alive = true;
    setQr('');
    if (value) qrDataUrl(value).then((u) => { if (alive) setQr(u); }).catch(() => {});
    return () => { alive = false; };
  }, [value]);
  return qr;
}

/** One side of a card, filled and drawn inline. */
export function IdCardSide({ kind, side, fill, prefix, className = '' }) {
  const [tpl, setTpl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadIdTemplate(kind, side).then((t) => { if (alive) setTpl(t); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [kind, side]);
  const html = useMemo(() => (tpl && fill
    ? scopeSvgIds(fillIdCard(tpl, fill), prefix).replace(/width="85\.6mm" height="54mm"/, 'width="100%" height="100%"')
    : ''), [tpl, fill, prefix]);
  if (failed) return <div className={`pf-card-fail ${className}`}>The ID design could not be loaded.</div>;
  if (!html) return <div className={`pf-card-skel ${className}`} aria-hidden="true" />;
  // eslint-disable-next-line react/no-danger
  return <div className={`pf-card-svg ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

const LOST_NOTE_DAYS = 60;

export default function MyIdCard({ userData, darkMode, state, loading, onReload, onChange, verseText, verseRef, onEditAbout, onToast, onConfirm, isAdmin }) {
  const [side, setSide] = useState('front');
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState('');
  const card = state?.card;
  const qr = useQr(card?.qr_value);
  const fill = useMemo(() => buildIdFill({
    card, theme: darkMode ? 'dark' : 'light', qr, photo: userData?.profile_picture || card?.photo, verseText, verseRef,
  }), [card, darkMode, qr, userData?.profile_picture, verseText, verseRef]);

  useEffect(() => {
    if (!showQr) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setShowQr(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showQr]);

  if (loading && !state) {
    return (<><div className="pf-head"><h3>My ID</h3></div><div className="pf-cardwrap"><div className="pf-card-skel" /></div></>);
  }
  if (state?.error) {
    return (
      <><div className="pf-head"><h3>My ID</h3></div>
        <div className="pf-empty"><b>Your ID could not be loaded</b>{state.error}<button type="button" className="pf-quiet" onClick={onReload}>Try again</button></div></>
    );
  }
  if (!state) return null;
  if (!state.eligible) {
    return (<><div className="pf-head"><h3>My ID</h3></div><div className="pf-empty"><i className="fas fa-id-card" aria-hidden="true"></i><b>No ID yet</b>{state.reason}</div></>);
  }

  const kind = card.kind;
  const name = card.id_no || 'church-id';
  const lostRecently = card.lost_at && (Date.now() - new Date(card.lost_at).getTime()) < LOST_NOTE_DAYS * 86400000;
  const missingContact = state.ready && !(card.emergency_name && card.emergency_phone);
  const flip = () => setSide((s) => (s === 'front' ? 'back' : 'front'));
  const exportFill = { ...fill, photo: userData?.profile_picture || card.photo };

  const run = async (what, fn) => {
    setBusy(what);
    try { await fn(); } catch (e) { onToast?.(e.message || 'That did not work. Please try again.', 'danger'); } finally { setBusy(''); }
  };
  const reportLost = () => onConfirm?.(
    'Report your printed ID card lost? Its QR code and door tap-in stop working now, and the church office is asked to print you a new card.',
    () => run('lost', async () => {
      const res = await fetch('/api/profile/id-card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: userData.id, action: 'lost' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Your report could not be sent. Please try again.');
      onChange?.(data);
      onToast?.(data.message, 'success');
    }),
    { title: 'Report lost card', confirmLabel: 'Report lost', icon: 'fa-id-card', confirmIcon: 'fa-triangle-exclamation' },
  );

  return (
    <>
      <div className="pf-head">
        <h3>My ID</h3>
        <span className="pf-status"><i className="pf-dot" aria-hidden="true"></i><b>Active</b> {ID_CARD_TITLE[kind]}{card.valid_until ? ` · valid until ${card.valid_until}` : ''}</span>
      </div>

      <div className="pf-cardwrap">
        <div
          className={`pf-flip ${side === 'back' ? 'back' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`Your ${ID_CARD_TITLE[kind]}, ${side}. Press to see the ${side === 'front' ? 'back' : 'front'}.`}
          onClick={flip}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } }}
        >
          <div className="pf-flip-in">
            <IdCardSide kind={kind} side="front" fill={fill} prefix="idf" className="pf-face" />
            <IdCardSide kind={kind} side="back" fill={fill} prefix="idb" className="pf-face pf-face-b" />
          </div>
        </div>
      </div>

      {lostRecently && <p className="pf-note"><i className="fas fa-circle-info"></i> You reported your printed card lost. Your old card no longer works; the church office will print you a new one.</p>}
      {missingContact && <p className="pf-note"><i className="fas fa-circle-info"></i> Add an emergency contact in <button type="button" className="pf-link" onClick={onEditAbout}>About me</button> to complete the back of your card.</p>}
      {!state.ready && isAdmin && <p className="pf-note"><i className="fas fa-database"></i> Run <b>supabase/migrations/member_id_cards.sql</b> in the Supabase SQL editor to turn on the QR code, the dates and emergency contacts.</p>}

      <div className="pf-spacer" />
      <div className="pf-toolrow">
        <div className="pf-tools" role="toolbar" aria-label="ID actions">
          <button type="button" className="pf-tool" onClick={flip}><i className="fas fa-rotate"></i> <span>{side === 'front' ? 'Show back' : 'Show front'}</span></button>
          <button type="button" className="pf-tool" onClick={() => setShowQr(true)} disabled={!qr}><i className="fas fa-qrcode"></i> <span>QR code</span></button>
          <button type="button" className="pf-tool" disabled={!!busy} onClick={() => run('dl', () => downloadIdPng(kind, exportFill, `${name}.png`))}>
            <i className={`fas ${busy === 'dl' ? 'fa-spinner fa-spin' : 'fa-download'}`}></i> <span>Download</span>
          </button>
          <button type="button" className="pf-tool" disabled={!!busy} onClick={() => run('print', () => printId(kind, exportFill, `${card.full_name} · ${ID_CARD_TITLE[kind]}`))}>
            <i className={`fas ${busy === 'print' ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> <span>Print</span>
          </button>
        </div>
        {state.ready && <button type="button" className="pf-quiet" onClick={reportLost} disabled={busy === 'lost'}>Report lost card</button>}
      </div>

      {showQr && qr && typeof document !== 'undefined' && createPortal(
        <div className="pf-qr-root" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowQr(false); }}>
          <div className="pf-qr" role="dialog" aria-modal="true" aria-label="Your ID QR code">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code" />
            <h4>{card.full_name}</h4>
            <p>{[card.id_no, ID_CARD_TITLE[kind], card.valid_until && `valid until ${card.valid_until}`].filter(Boolean).join(' · ')}</p>
            <p className="pf-qr-hint">Show this to the usher at the door. Turn your screen brightness up if it does not scan.</p>
            <button type="button" onClick={() => setShowQr(false)} autoFocus>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
