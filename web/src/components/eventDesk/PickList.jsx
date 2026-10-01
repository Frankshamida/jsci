'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './pickList.css';

// A dropdown for the event desks, in place of the browser's own <select>:
// grouped options, a line of detail under each, a badge saying why one cannot
// be chosen (Full, Not arrived, In 316), and a search box for long lists.
// The list is portalled and fixed to the screen, so a card that clips its
// contents cannot cut it off, and it opens upwards near the bottom.
//
// options: [{ value, label, sub?, badge?, tone?: 'ok'|'warn'|'muted'|'info', disabled?, group? }]
export default function PickList({
  value = '',
  onChange,
  options = [],
  placeholder = 'Choose…',
  disabled = false,
  searchable = false,
  ariaLabel,
  className = '',
  size = 'md',
  emptyText = 'Nothing to choose from',
}) {
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');

  const chosen = options.find((o) => o.value === value) || null;

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 300);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 260 && above > below;
    const maxHeight = Math.max(160, Math.min(360, up ? above : below));
    setPos(up ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight } : { left, width, top: r.bottom + 6, maxHeight });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => place();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // The chosen one in view when the list opens.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const on = listRef.current.querySelector('.pl-opt.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }, [open, pos]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => `${o.label} ${o.sub || ''} ${o.badge || ''} ${o.group || ''}`.toLowerCase().includes(needle))
    : options;
  // In the order given, a heading wherever the group changes.
  const rows = [];
  let lastGroup = null;
  shown.forEach((o) => {
    if (o.group && o.group !== lastGroup) { rows.push({ head: o.group }); lastGroup = o.group; }
    rows.push({ opt: o });
  });

  const pick = (o) => {
    if (o.disabled) return;
    onChange?.(o.value);
    setOpen(false);
    setQ('');
  };

  return (
    <div className={`pl ${size === 'sm' ? 'pl-sm' : ''} ${className}`}>
      <button
        ref={btnRef}
        type="button"
        className={`pl-btn ${open ? 'open' : ''} ${chosen ? 'has-value' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {chosen ? (
          <span className="pl-val">
            <b>{chosen.label}</b>
            {chosen.sub && <em>{chosen.sub}</em>}
          </span>
        ) : (
          <span className="pl-ph">{placeholder}</span>
        )}
        <i className={`fas fa-chevron-${open ? 'up' : 'down'}`}></i>
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="pl-scrim" onClick={() => { setOpen(false); setQ(''); }} />
          <div className="pl-pop" style={pos} role="listbox" aria-label={ariaLabel}>
            {searchable && (
              <div className="pl-search">
                <i className="fas fa-magnifying-glass"></i>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" autoFocus />
              </div>
            )}
            <div className="pl-list" ref={listRef} style={{ maxHeight: pos.maxHeight - (searchable ? 52 : 0) }}>
              {rows.length === 0 && <p className="pl-empty">{needle ? `Nothing matches "${q}"` : emptyText}</p>}
              {rows.map((row, i) => (row.head ? (
                <div key={`h-${row.head}-${i}`} className="pl-head">{row.head}</div>
              ) : (
                <button
                  key={row.opt.value}
                  type="button"
                  role="option"
                  aria-selected={row.opt.value === value}
                  aria-disabled={!!row.opt.disabled}
                  className={`pl-opt ${row.opt.value === value ? 'on' : ''} ${row.opt.disabled ? 'off' : ''}`}
                  onClick={() => pick(row.opt)}
                  title={row.opt.disabled && row.opt.badge ? row.opt.badge : undefined}
                >
                  <span className="pl-opt-text">
                    <b>{row.opt.label}</b>
                    {row.opt.sub && <em>{row.opt.sub}</em>}
                  </span>
                  {row.opt.badge && <span className={`pl-badge ${row.opt.tone ? `is-${row.opt.tone}` : ''}`}>{row.opt.badge}</span>}
                  {row.opt.value === value && <i className="fas fa-check pl-tick"></i>}
                </button>
              )))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
