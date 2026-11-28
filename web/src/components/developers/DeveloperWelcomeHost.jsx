'use client';

// The one "Meet the Developers" window on every page, in the root layout.
// Whatever opens it (the homepage after a moment, or a footer's "Meet the
// Developers") goes through lib/developerWelcome, so there is only ever one.
//
// A real dialog: labelled by its headline, focus kept inside it (Tab and
// Shift+Tab wrap), Esc and a click on the dimmed page close it, the page
// behind does not scroll, and focus goes back to whatever opened it.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useBranding } from '@/components/BrandingProvider';
import {
  subscribe, getState, getData, SERVER_STATE, SERVER_DATA, closeDevelopers, loadDevelopers, isOptedOut, setOptOut, takeReturnFocus,
} from '@/lib/developerWelcome';
import DeveloperWelcome from './DeveloperWelcome';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function DeveloperWelcomeHost() {
  const st = useSyncExternalStore(subscribe, getState, () => SERVER_STATE);
  const data = useSyncExternalStore(subscribe, getData, () => SERVER_DATA);
  const brand = useBranding();
  const titleId = useId();
  const dialogRef = useRef(null);
  const [optOut, setOptOutBox] = useState(false);
  const opt = useRef({ start: false, now: false });
  const downOnBackdrop = useRef(false);

  // "Don't show this again" is saved as the window closes, ticked or not.
  const close = useRef(() => {});
  close.current = () => {
    if (opt.current.now !== opt.current.start) setOptOut(opt.current.now);
    closeDevelopers();
  };
  const tick = (on) => { opt.current.now = on; setOptOutBox(on); };

  useEffect(() => {
    if (!st.open) return undefined;
    const was = isOptedOut();
    opt.current = { start: was, now: was };
    setOptOutBox(was);

    // The page behind stays put (and does not jump by a scrollbar's width).
    const body = document.body;
    const prev = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    const onKey = (e) => {
      const box = dialogRef.current;
      if (!box) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === box || !box.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.paddingRight;
      const back = takeReturnFocus();
      try {
        if (back && back !== document.body && document.contains(back)) back.focus({ preventScroll: true });
      } catch { /* nothing to go back to */ }
    };
  }, [st.open]);

  if (!st.open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="dw-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) close.current(); }}
    >
      <div className="dw-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        <DeveloperWelcome
          developers={data.developers}
          settings={data.settings}
          status={data.status}
          error={data.error}
          onRetry={() => loadDevelopers({ force: true })}
          onClose={() => close.current()}
          titleId={titleId}
          platform={brand?.platform || 'SanctuaryHub'}
          optOut={optOut}
          onOptOut={tick}
        />
      </div>
    </div>,
    document.body,
  );
}
