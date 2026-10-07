'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './verifyFind.css';

// Verify Attendee, by name - for somebody standing at the desk without their
// card (left at home, not handed out yet, not reading). Type part of a name,
// a church, a representative, a number or a reference; the list narrows as
// you type, and picking somebody opens them exactly as a card tap would.
//
// Its own component, with its own state, so typing re-draws this list and
// nothing else - the desk behind it is a very large page.
//
//   rows      everybody on the event (cancelled already left out)
//   textOf    the words a row is found by, lower case
//   nameOf    "SURNAME, First" as the desk shows it
//   subOf     the line under the name (church, representative)
//   listOf    'Early' | 'Late' | 'Walk-In'
//   statusOf  the desk's own status pill for the row
//   onPick    open them; onClose   leave without anybody
const LIMIT = 8;

export default function VerifyFindModal({ rows, textOf, nameOf, subOf, listOf, statusOf, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Built once per list of rows, not once per keystroke.
  const index = useMemo(() => rows.map((r) => ({ r, text: textOf(r), name: nameOf(r) })), [rows, textOf, nameOf]);

  const { found, more } = useMemo(() => {
    const words = deferred.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return { found: [], more: 0 };
    const hits = index.filter((it) => words.every((w) => it.text.includes(w)));
    // A name that starts with what was typed first, then the rest, A to Z.
    const first = words[0];
    const rank = (it) => (it.name.toLowerCase().split(/[\s,]+/).some((w) => w.startsWith(first)) ? 0 : 1);
    hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { found: hits.slice(0, LIMIT).map((it) => it.r), more: Math.max(0, hits.length - LIMIT) };
  }, [index, deferred]);

  useEffect(() => { setActive(0); }, [deferred]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  // The highlighted row stays in view as the arrows move it.
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(0, found.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (found[active]) onPick(found[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="evt-modal-overlay vfind-overlay" onClick={onClose}>
      <div className="evt-modal evt-verify-pop vfind" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Verify Attendee">
        <div className="evt-modal-head">
          <div><h3><i className="fas fa-user-check"></i> Verify Attendee</h3><p>Find them by name - no card needed</p></div>
          <button type="button" className="evt-modal-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>
        <div className="evt-modal-body">
          <div className="vfind-search">
            <i className="fas fa-magnifying-glass"></i>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Type a name, church, representative or reference"
              aria-label="Search attendees"
              aria-autocomplete="list"
              aria-controls="vfind-list"
              autoComplete="off"
              data-lpignore="true"
              data-form-type="other"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear">
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>

          {!deferred.trim() ? (
            <p className="vfind-hint"><i className="fas fa-keyboard"></i> Start typing - the list fills as you go. Use ↑ ↓ and Enter, or tap a name.</p>
          ) : found.length === 0 ? (
            <p className="vfind-hint is-none"><i className="fas fa-user-slash"></i> Nobody on this event matches “{deferred.trim()}”.</p>
          ) : (
            <ul className="vfind-list" id="vfind-list" role="listbox" ref={listRef}>
              {found.map((r, i) => (
                <li key={r.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    data-i={i}
                    className={`vfind-row ${i === active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onPick(r)}
                  >
                    <span className="vfind-name">
                      <b>{nameOf(r)}</b>
                      <small>
                        <span className={`vfind-list-tag is-${listOf(r).toLowerCase().replace(/[^a-z]/g, '')}`}>{listOf(r)}</span>
                        {subOf(r) && <span className="vfind-sub">{subOf(r)}</span>}
                      </small>
                    </span>
                    <span className="vfind-status">{statusOf(r)}</span>
                    <i className="fas fa-chevron-right vfind-go"></i>
                  </button>
                </li>
              ))}
              {more > 0 && <li className="vfind-more">{more} more - keep typing to narrow it down</li>}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
