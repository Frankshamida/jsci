'use client';

// Dashboard > Social Media: the pieces the Sunday Service and the Midweek
// Service tabs are both built from, so the two look and work the same - the
// card with its title, numbers, filters and search; one row per service with
// its thumbnail, Edit and a Manage menu; the window a service is posted and
// edited in; and the thumbnail with its five templates.
//
// Styled by social.css. Every colour comes from the .sm-theme tokens, which
// dark mode only re-colours - the same elements, the same sizes - and each
// colour eases from one mode to the other.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MidweekThumbnail from '@/components/midweek/MidweekThumbnail';
import { thumbnailPng } from '@/lib/midweekThumbnailClient';
import { THUMBNAIL_TEMPLATES, slugify } from '@/lib/serviceVideos';
import './social.css';

// A value that settles: the thumbnails redraw 150 ms after typing stops.
export function useSettled(value, ms = 150) {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(JSON.parse(key)), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return settled;
}

// A 1280 x 720 PNG of a thumbnail, saved - for posting on Facebook (with the
// template's own play icon; there is no page around it there).
export async function downloadThumbnail(template, data, date) {
  const blob = await thumbnailPng(template, data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(data.title)}-${date || 'thumbnail'}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Let the browser finish saving the file before the picture is let go.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ---- A window over the page ----
// Escape or × closes it (not while saving); a click outside closes it only
// when nothing has been typed yet. Tab stays inside it, and the focus goes
// back where it was when it closes.
export function Modal({ title, subtitle, onClose, children, footer, small = false, busy = false, dirty = false, initialFocus }) {
  const titleId = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const state = useRef({ busy, dirty });
  state.current = { busy, dirty };

  useEffect(() => {
    const before = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const first = (initialFocus && ref.current?.querySelector(initialFocus)) || ref.current?.querySelector(FOCUSABLE);
    setTimeout(() => (first || ref.current)?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape' && !state.current.busy) { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const all = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!all.length) return;
      const [a, z] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, [initialFocus]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="sm-theme sm-modal-root">
      <div className="sm-overlay" onClick={() => { if (!state.current.busy && !state.current.dirty) onClose?.(); }} aria-hidden="true"></div>
      <div ref={ref} className={`sm-dialog ${small ? 'is-small' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sm-dialog-head">
          <div>
            <h3 id={titleId}>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="sm-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="sm-dialog-body">{children}</div>
        {footer && <div className="sm-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// "Are you sure?", in the same window.
export function Confirm({ title, text, confirmLabel, onConfirm, onCancel, busy = false, danger = true }) {
  return (
    <Modal
      small
      title={title}
      onClose={onCancel}
      busy={busy}
      initialFocus=".sm-confirm-cancel"
      footer={(
        <>
          <button type="button" className="sm-btn sm-confirm-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`sm-btn ${danger ? 'is-danger-solid' : 'is-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      <p className="sm-confirm-text">{text}</p>
    </Modal>
  );
}

// ---- Manage ▾ ----
// items: [{ label, onClick | href, danger, divider }] (falsy ones are skipped).
// A menu button: arrow keys move through it, Escape closes it, and it opens
// upward when there is no room below.
export function ManageMenu({ items, disabled = false, label = 'Manage' }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const list = useRef(null);
  const menuId = useId();
  const shown = items.filter(Boolean);

  const close = useCallback((focusButton = false) => {
    setOpen(false);
    if (focusButton) btn.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !list.current || !btn.current) return;
    const b = btn.current.getBoundingClientRect();
    const h = list.current.offsetHeight;
    setUp(b.bottom + h + 12 > window.innerHeight && b.top > h + 12);
    list.current.querySelector('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const onKey = (e) => {
    const all = [...(list.current?.querySelectorAll('[role="menuitem"]') || [])];
    const at = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); all[(at + 1) % all.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); all[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); all[all.length - 1]?.focus(); }
    else if (e.key === 'Tab') close();
  };

  return (
    <div className="sm-menu" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="sm-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {label} <span className="sm-caret" aria-hidden="true"></span>
      </button>
      {open && (
        <div ref={list} id={menuId} className={`sm-menu-list ${up ? 'is-up' : ''}`} role="menu" onKeyDown={onKey}>
          {shown.map((it, i) => (it.divider ? (
            <div key={`d${i}`} className="sm-menu-sep" role="separator"></div>
          ) : it.href ? (
            <a
              key={it.label}
              role="menuitem"
              tabIndex={-1}
              className={`sm-menu-item ${it.danger ? 'is-danger' : ''}`}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => close()}
            >
              {it.label}
            </a>
          ) : (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`sm-menu-item ${it.danger ? 'is-danger' : ''}`}
              onClick={() => { close(true); it.onClick?.(); }}
            >
              {it.label}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

// ---- The card a tab is: title, numbers, filters, search, notice ----

export function ManagerHead({ title, text, pageHref, pageLabel, action }) {
  return (
    <div className="sm-head">
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div className="sm-head-actions">
        <a href={pageHref} target="_blank" rel="noopener noreferrer" className="sm-btn is-ghost">{pageLabel}</a>
        {action}
      </div>
    </div>
  );
}

// [{ value, label, live }]
export function Stats({ items }) {
  return (
    <div className="sm-stats">
      {items.map((s) => (
        <div key={s.label} className="sm-stat">
          <strong className={s.live ? 'is-live' : ''}>{s.value}</strong>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// filters: [{ key, label, count }]
export function Toolbar({ filters, filter, onFilter, query, onQuery, placeholder }) {
  return (
    <div className="sm-toolbar">
      <div className="sm-filters" role="tablist" aria-label="Show">
        {filters.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'on' : ''} onClick={() => onFilter(f.key)}>
            {f.label}{f.count != null && <span className="sm-count">{f.count}</span>}
          </button>
        ))}
      </div>
      <input type="search" className="sm-search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function Notice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`sm-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

// One service in the list. status: { tone: 'live' | 'on' | 'off', label }
export function Row({ thumb, status, title, meta, onEdit, menu, busy = false, off = false }) {
  return (
    <li className={`sm-row ${busy ? 'is-busy' : ''} ${off ? 'is-off' : ''}`}>
      <button type="button" className="sm-row-thumb" onClick={onEdit} tabIndex={-1} aria-hidden="true">{thumb}</button>
      <div className="sm-row-main">
        <div className="sm-row-top">
          <span className={`sm-status ${status.tone}`}>
            {status.tone === 'live' && <span className="sm-dot" aria-hidden="true"></span>}
            {status.label}
          </span>
        </div>
        <button type="button" className="sm-row-title" onClick={onEdit}>{title}</button>
        <span className="sm-row-meta">{meta}</span>
      </div>
      <div className="sm-row-actions">
        <button type="button" className="sm-btn" onClick={onEdit} disabled={busy}>Edit</button>
        <ManageMenu items={menu} disabled={busy} />
      </div>
    </li>
  );
}

// ---- The form's pieces ----

export function Field({ id, label, required = false, optional = false, children, below }) {
  return (
    <div className="sm-field">
      <label className="sm-label" htmlFor={id}>
        {label}{required && <span className="sm-req" aria-hidden="true"> *</span>}{optional && <em>optional</em>}
      </label>
      {children}
      {below}
    </div>
  );
}

export function Switch({ checked, onChange, title, text, tone }) {
  return (
    <label className={`sm-switch ${tone === 'live' ? 'is-live' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sm-toggle" aria-hidden="true"></span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </label>
  );
}

// The five templates as a radio group: each card a live mini preview with
// what is typed in the form. Arrow keys move the choice, as in any radio group.
function TemplatePicker({ value, onChange, data, labelledBy }) {
  const refs = useRef([]);
  const at = Math.max(0, THUMBNAIL_TEMPLATES.findIndex((t) => t.key === value));
  const pick = (i) => {
    const n = (i + THUMBNAIL_TEMPLATES.length) % THUMBNAIL_TEMPLATES.length;
    onChange(THUMBNAIL_TEMPLATES[n].key);
    refs.current[n]?.focus();
  };
  const onKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) { e.preventDefault(); pick(i + step); }
    else if (e.key === 'Home') { e.preventDefault(); pick(0); }
    else if (e.key === 'End') { e.preventDefault(); pick(THUMBNAIL_TEMPLATES.length - 1); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(i); }
  };
  return (
    <div className="sm-tpls" role="radiogroup" aria-labelledby={labelledBy}>
      {THUMBNAIL_TEMPLATES.map((t, i) => {
        const on = t.key === value;
        return (
          <div
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            role="radio"
            aria-checked={on}
            aria-label={t.name}
            tabIndex={i === at ? 0 : -1}
            className={`sm-tpl ${on ? 'on' : ''}`}
            onClick={() => pick(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <MidweekThumbnail template={t.key} {...data} showPlayIcon={false} />
            <span className="sm-tpl-name">{t.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// The right side of the form: the thumbnail, large, its five templates, and
// Download PNG.
export function ThumbnailPanel({ template, onTemplate, data, date, pageName }) {
  const labelId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    setError('');
    try { await downloadThumbnail(template, data, date); } catch (err) { setError(err.message || 'The picture could not be made.'); }
    setBusy(false);
  };
  return (
    <div className="sm-preview">
      <div className="sm-preview-head">
        <span className="sm-label">Thumbnail</span>
        <button type="button" className="sm-btn is-small" onClick={download} disabled={busy || !data} title="A 1280 x 720 picture, for posting on Facebook">
          {busy ? 'Making…' : 'Download PNG'}
        </button>
      </div>
      <div className="sm-big">
        {data && <MidweekThumbnail template={template} {...data} showPlayIcon={false} />}
      </div>
      <p className="sm-hint">{error || `Made from the title, date and speaker. Change the title and it changes here and on the ${pageName} page.`}</p>
      <span className="sm-label" id={labelId}>Template</span>
      {data && <TemplatePicker value={template} onChange={onTemplate} data={data} labelledBy={labelId} />}
    </div>
  );
}

// A row's small thumbnail.
export function RowThumb({ template, title, date, speaker, label }) {
  return <MidweekThumbnail template={template} title={title} date={date} speaker={speaker} label={label} showPlayIcon={false} />;
}
