'use client';

// The name and the small line under it in the sidebar ("SANCTUARYHUB" over
// "CHURCH PLATFORM", or the church's name over "INTERNATIONAL"), drawn the
// same width. The small line keeps its wide letter-spacing and sets the width;
// the name's font size is worked out to match it exactly, in whatever font has
// loaded. Styles: .brand-text, .brand-name, .brand-sub in dashboard.css.

import { useLayoutEffect, useRef } from 'react';

const MAX_PX = 30;

export default function BrandLockup({ name, sub }) {
  const nameRef = useRef(null);
  const subRef = useRef(null);

  useLayoutEffect(() => {
    const n = nameRef.current;
    const s = subRef.current;
    if (!n || !s) return undefined;
    const fit = () => {
      n.style.fontSize = '';
      const subWidth = s.getBoundingClientRect().width;
      const nameWidth = n.getBoundingClientRect().width;
      if (!subWidth || !nameWidth) return;
      // letter-spacing also follows the last letter; that space is not ink.
      const target = subWidth - (parseFloat(getComputedStyle(s).letterSpacing) || 0);
      const base = parseFloat(getComputedStyle(n).fontSize) || 16;
      const size = Math.min(MAX_PX, Math.max(base * 0.6, (base * target) / nameWidth));
      n.style.fontSize = `${size.toFixed(2)}px`;
    };
    fit();
    // Again once the web font is in, and whenever the small line's width changes.
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) fit(); });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(s);
    return () => { alive = false; ro?.disconnect(); };
  }, [name, sub]);

  return (
    <div className="brand-text">
      <span ref={nameRef} className="brand-name">{name}</span>
      <span ref={subRef} className="brand-sub">{sub}</span>
    </div>
  );
}
