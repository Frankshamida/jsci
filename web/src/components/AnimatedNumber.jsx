'use client';

import { useEffect, useRef, useState } from 'react';

// A figure that glides to its new value instead of jumping - the money tiles
// on an event, where ₱41,100 to collect becoming ₱40,800 is the desk's work
// showing up. A change mid-glide carries on from wherever it had got to.
//
// For a moment after it changes it carries `is-up` or `is-down`, so the
// stylesheet can flash it. With reduced motion asked for, it just changes.
export default function AnimatedNumber({ value, format = (n) => n.toLocaleString(), duration = 700, className = '' }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const [dir, setDir] = useState('');
  const shownRef = useRef(target);
  const frameRef = useRef(0);
  const flashRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return undefined;
    setDir(target > from ? 'is-up' : 'is-down');
    clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setDir(''), duration + 500);

    const still = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const v = t >= 1 ? target : from + (target - from) * eased;
      shownRef.current = v;
      setShown(v);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  useEffect(() => () => { cancelAnimationFrame(frameRef.current); clearTimeout(flashRef.current); }, []);

  return <span className={`anim-num ${dir} ${className}`.trim()}>{format(Math.round(shown))}</span>;
}
