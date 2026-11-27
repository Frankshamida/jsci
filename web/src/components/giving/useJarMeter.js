'use client';

// The gold bar beside a jar of hearts, filling WITH the jar: it starts empty,
// grows while the hearts fall in, and stops at the amount as the last heart
// lands. The jar says how long its hearts take (heartjar:filling, from
// public/heart-jar/heart-jar.js), so the two always move and stop together.
//
//   const meter = useJarMeter(percent, { animated });
//   <GivingJar ... animateOnLoad onReady={meter.onJarReady} />
//   <span className="gv-meter" ref={meter.barRef}><span style={meter.fillStyle} /></span>
//
//   percent   where the bar ends, 0-100 (the page's own numbers)
//   animated  the jar's hearts fall in as it appears (animateOnLoad, not
//             static). False: the bar is drawn full at once, like its jar.
//   withJar   false for a bar with no jar beside it: it fills over a moment
//             as it scrolls into view.
//
// Safe however things arrive: a jar whose fill began before the bar listened
// (jar.lastFilling), a later gift (every new fill moves the bar again), a jar
// that never loads (the bar fills on its own a few seconds after it is seen),
// and reduced motion (no movement at all).

import { useCallback, useEffect, useRef, useState } from 'react';

// Close to even, as the hearts fall at a steady pace; a soft stop.
const EASE = 'cubic-bezier(0.3, 0.2, 0.45, 1)';
const ALONE_MS = 1100;     // a bar with no jar
const FALLBACK_MS = 5000;  // seen this long with no jar filling: fill anyway
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (p) => Math.max(0, Math.min(100, Number(p) || 0));

export function useJarMeter(percent, { animated = true, withJar = true } = {}) {
  const target = clamp(percent);
  const [bar, setBar] = useState({ width: animated ? 0 : target, ms: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;
  const widthRef = useRef(bar.width);
  widthRef.current = bar.width;
  const fillingUntil = useRef(0);   // when the jar's current fill ends
  const started = useRef(!animated);
  const detach = useRef(null);
  const barRef = useRef(null);

  const go = useCallback((ms) => {
    started.current = true;
    setBar({ width: targetRef.current, ms: Math.max(0, Math.round(ms)) });
  }, []);

  // The jar is on the page: follow its fills.
  const onJarReady = useCallback((jar) => {
    detach.current?.();
    if (!jar) return;
    const follow = (f) => {
      if (!f) return;
      const left = (f.startedAt || performance.now()) + (f.duration || 0) - performance.now();
      fillingUntil.current = performance.now() + Math.max(0, left);
      go(Math.max(250, left));
    };
    const onFilling = (e) => follow(e.detail);
    // Hearts taken away (a gift's replay dips first): the bar dips with them.
    const onProgress = (e) => {
      const fill = Number(e.detail?.fill);
      if (Number.isFinite(fill) && fill * 100 < widthRef.current - 0.5 && e.detail?.goal) {
        setBar({ width: Math.max(0, fill * 100), ms: 0 });
      }
    };
    // Whatever happened, the bar ends where the amount is (a jar that never
    // said how long it would take - an older heart-jar.js - included).
    const onSettled = () => {
      if (performance.now() >= fillingUntil.current && Math.abs(widthRef.current - targetRef.current) > 0.5) go(600);
      started.current = true;
    };
    jar.addEventListener('heartjar:filling', onFilling);
    jar.addEventListener('heartjar:progress', onProgress);
    jar.addEventListener('heartjar:settled', onSettled);
    detach.current = () => {
      jar.removeEventListener('heartjar:filling', onFilling);
      jar.removeEventListener('heartjar:progress', onProgress);
      jar.removeEventListener('heartjar:settled', onSettled);
    };
    // A fill that began before we listened.
    const last = jar.lastFilling;
    if (last && (last.startedAt || 0) + (last.duration || 0) > performance.now()) follow(last);
  }, [go]);

  useEffect(() => () => detach.current?.(), []);

  // Reduced motion: no movement, the bar as it ends.
  useEffect(() => {
    if (animated && calm()) go(0);
  }, [animated, go]);

  // A new amount (a gift arrived): move there, in step with a fill under way.
  // Before the first fill, that fill takes the bar there by itself.
  const prevTarget = useRef(target);
  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    if (!started.current) return;
    const left = fillingUntil.current - performance.now();
    go(left > 0 ? left : 700);
  }, [target, go]);

  // Seen, but no jar is filling (no jar, or it could not load): fill anyway.
  useEffect(() => {
    if (!animated || started.current) return undefined;
    const node = barRef.current;
    let timer;
    const start = () => { timer = setTimeout(() => { if (!started.current) go(withJar ? 1200 : ALONE_MS); }, withJar ? FALLBACK_MS : 120); };
    if (!node || typeof IntersectionObserver === 'undefined') { start(); return () => clearTimeout(timer); }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { threshold: 0.6 });
    io.observe(node);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [animated, withJar, go]);

  return {
    barRef,
    onJarReady,
    fillStyle: { width: `${bar.width}%`, transition: bar.ms ? `width ${bar.ms}ms ${EASE}` : 'none' },
  };
}
