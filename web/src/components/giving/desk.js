'use client';

// The parts every dashboard Giving page is built from (givingDesk.css):
// the page head, the summary strip with its split bar, the tabs, the pager,
// a drive's small photo, a status pill and the side panel.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { peso } from '@/lib/giving';
import './givingDesk.css';

export const JAR_IMAGE = '/giving-assets/web/jar.webp';

// A Cloudinary photo at the size it is shown, not the full upload: a drive's
// cover is a phone photo of several MB, and a thumbnail needs 30 pixels of it.
// Other links, and links already sized, are left as they are.
export function sized(src, w, h) {
  const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(String(src || ''));
  if (!m || /^[a-z]{1,3}_[^/]*,|^[a-z]{1,3}_[^/]*\//.test(m[2])) return src || '';
  return `${m[1]}c_fill,g_auto,w_${w},h_${h},q_auto,f_auto/${m[2]}`;
}
export const PAGE_SIZES = [10, 25, 50];

export function DeskHead({ title, sub, children }) {
  return (
    <header className="gd-head">
      <div className="gd-head-text">
        <h2 className="gd-title">{title}</h2>
        {sub && <p className="gd-sub">{sub}</p>}
      </div>
      {children && <div className="gd-head-act">{children}</div>}
    </header>
  );
}

// stats: [{ k, v, s, hot }]; split: { label, parts: [{ name, value, color }] }
export function Strip({ stats, split, label = 'Summary' }) {
  return (
    <section className="gd-card gd-strip" aria-label={label}>
      <div className={`gd-stats ${stats.length === 2 ? 'is-two' : ''}`} style={stats.length !== 3 ? { gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` } : undefined}>
        {stats.map((x) => (
          <div key={x.k} className={`gd-stat ${x.hot ? 'is-hot' : ''}`}>
            <div className="gd-stat-k">{x.k}</div>
            <div className="gd-stat-v">{x.v}</div>
            {x.s && <div className="gd-stat-s">{x.s}</div>}
          </div>
        ))}
      </div>
      {split && <SplitBar {...split} />}
    </section>
  );
}

export function SplitBar({ label, parts }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div className="gd-split">
      <span className="gd-split-k">{label}</span>
      <div className={`gd-sbar ${total ? '' : 'is-empty'}`} role="img" aria-label={parts.map((p) => `${p.name} ${peso(p.value)}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <i key={p.name} style={{ flex: p.value, background: p.color }} title={`${p.name}: ${peso(p.value)}`}></i>
        ))}
      </div>
      <div className="gd-legend">
        {parts.map((p) => (
          <span key={p.name}><i style={{ background: p.color }}></i>{p.name} <b>{peso(p.value)}</b> {pct(p.value)}%</span>
        ))}
      </div>
    </div>
  );
}

// items: [{ key, label, count }]
export function Tabs({ items, value, onChange, label = 'Filter' }) {
  return (
    <div className="gd-tabs" role="group" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} type="button" className="gd-tab" aria-pressed={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <em>{t.count}</em>}
        </button>
      ))}
    </div>
  );
}

// Page numbers: the first, the last, and the ones beside the page you are on.
export function Pager({ total, page, per, onPage, onPer }) {
  const pages = Math.max(1, Math.ceil(total / per));
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== 'gap') nums.push('gap');
  }
  const from = total ? (page - 1) * per + 1 : 0;
  const to = Math.min(total, page * per);
  return (
    <nav className="gd-pager" aria-label="Pages">
      <span>{from}–{to} of {total}</span>
      <div className="gd-pages">
        <button type="button" className="gd-pg" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
        {nums.map((p, i) => (p === 'gap'
          ? <span key={`g${i}`} aria-hidden="true">…</span>
          : <button key={p} type="button" className="gd-pg" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))}
        <button type="button" className="gd-pg" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">›</button>
      </div>
      {onPer ? (
        <label className="gd-per">Rows
          <select className="gd-input" value={per} onChange={(e) => onPer(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : <span></span>}
    </nav>
  );
}

/** The page of a list to show, and the page kept in range when the list shrinks. */
export function pageOf(list, page, per) {
  const pages = Math.max(1, Math.ceil(list.length / per));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, rows: list.slice((p - 1) * per, p * per) };
}

export function DriveThumb({ src }) {
  return (
    <span className={`gd-thumb ${src ? '' : 'is-jar'}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src ? sized(src, 120, 88) : JAR_IMAGE} alt="" loading="lazy" decoding="async" />
    </span>
  );
}

export const Pill = ({ tone, children }) => <span className={`gd-pill ${tone}`}>{children}</span>;

// The side panel: drawn in the body, closes on Escape or a click outside,
// and gives focus back to what opened it.
export function Drawer({ label, onClose, head, children, foot }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement;
    box.current?.querySelector('.gd-x')?.focus();
    const onKey = (e) => {
      // A window opened from the panel (a confirm) handles its own Escape.
      if (e.key === 'Escape' && !document.querySelector('.sm-modal-root, .sm-overlay')) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="gd">
      <div className="gd-scrim" onClick={onClose} aria-hidden="true"></div>
      <aside ref={box} className="gd-drawer" role="dialog" aria-modal="true" aria-label={label}>
        <div className="gd-dr-head">
          <div>{head}</div>
          <button type="button" className="gd-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="gd-dr-body">{children}</div>
        {foot && <div className="gd-dr-foot">{foot}</div>}
      </aside>
    </div>,
    document.body,
  );
}
