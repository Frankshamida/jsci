'use client';

// The giving jar: the <heart-jar> element (public/heart-jar/heart-jar.js) in a
// box as wide as the page says (--gj-w). How the hearts fall in, fill the jar
// and spill over past the goal is all the element's own; this only puts it
// on the page and hands it the numbers.
//
//   amount, goal, softScale  what it shows: jarProps(drive) from lib/giving,
//                            always the server's numbers
//   animateOnLoad   the hearts fall in when it first appears - with `lazy`,
//                   when it is well into view, so they are seen falling
//   isStatic        never moves (the small jars on the /donation list)
//   keepSize        past the goal the spill is drawn just outside the box,
//                   instead of the jar getting smaller to make room for it
//   lazy            loaded and put on the page only as it scrolls into view
//                   (a jar is some 600 hearts, drawn or not)
//   backdrop        the abstract shapes behind the jar
//   shape           'jar' (tall, the jar's own shape) or 'square' (cards)
//   onReady(jar)            the element is on the page
//   onSettled(detail)       every falling heart has landed
//   onGoalReached(detail)   the hearts reached the goal and spilled over
//
// Until heart-jar.js has defined the element, an empty box of the jar's shape
// holds its place. Its first numbers are its attributes; after that a new
// amount is jar.setAmount(amount) - only the new hearts fall in, or the ones
// taken away go - and no goal is the goal attribute removed.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadHeartJar } from './heartJarLoader';
import './givingJar.css';

const attrText = (v) => (v == null || v === '' ? null : String(v));
const toAmount = (n) => Math.max(0, Number(n) || 0);
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function setAttr(jar, name, value) {
  const v = attrText(value);
  if (v == null) {
    if (jar.hasAttribute(name)) jar.removeAttribute(name);
  } else if (jar.getAttribute(name) !== v) {
    jar.setAttribute(name, v);
  }
}

// jar.setAmount(n). <heart-jar> says "settled" once what it moved has landed,
// or at once when it moves nothing on purpose (static, reduced motion). When
// the new amount simply adds no heart - a small gift in a big jar - nothing
// moves and it says nothing, so it is said here for it.
export function setJarAmount(jar, n) {
  let heard = false;
  const hear = () => { heard = true; };
  jar.addEventListener('heartjar:settled', hear);
  jar.setAmount(toAmount(n));
  // The element's own state: a frame booked means hearts are moving; the
  // spill may be about to start.
  if (jar._raf != null || jar._overflowPending === true) {
    jar.removeEventListener('heartjar:settled', hear);
    return;
  }
  setTimeout(() => {
    jar.removeEventListener('heartjar:settled', hear);
    if (heard) return;
    jar.dispatchEvent(new CustomEvent('heartjar:settled', {
      bubbles: true, composed: true, detail: { amount: jar.amount, goal: jar.goal || null, percent: jar.percent },
    }));
  }, 0);
}

// ---- How many hearts an amount shows ----
// <heart-jar>'s own rule (heart-jar.js _targetFill): with a goal the jar is
// amount/goal full, and full at the goal; without one it fills ever more
// slowly and never passes 92%. Each heart shows once the fill reaches its
// threshold (HeartJarAssets.layout.inner[].t), and any money shows at least
// the first. Known only once heart-jar-assets.js has loaded.
const NO_GOAL_TOP = 0.92;
const fillOf = (a, goal, soft) => (goal > 0 ? Math.min(1, a / goal) : NO_GOAL_TOP * (1 - Math.exp(-a / (soft || 10000))));
const amountAt = (fill, goal, soft) => (goal > 0 ? fill * goal : -(soft || 10000) * Math.log(1 - Math.min(fill, NO_GOAL_TOP * 0.999999) / NO_GOAL_TOP));
let thresholds = null;
function heartThresholds() {
  if (!thresholds && typeof window !== 'undefined' && window.HeartJarAssets?.layout?.inner) {
    thresholds = window.HeartJarAssets.layout.inner.map((d) => d.t).sort((x, y) => x - y);
  }
  return thresholds;
}
export function heartsShown({ amount, goal, softScale }) {
  const ts = heartThresholds();
  if (!ts) return null;
  const a = toAmount(amount);
  if (!a) return 0;
  const f = Math.max(fillOf(a, Number(goal) || 0, Number(softScale) || 0), ts[0]);
  let n = 0;
  while (n < ts.length && ts[n] <= f + 1e-6) n += 1;
  return n;
}

// ---- Hearts that drop again ----
// A little under `amount`: going back up from it drops REFILL_HEARTS hearts
// in, and past the goal pours the spill again. For the giver's own moment
// when their gift adds no heart by itself (a full jar, or a gift small beside
// what is there). The jar still ends at `amount`, as everyone sees it.
export const REFILL_HEARTS = 18;
export function refillFrom(props) {
  const ts = heartThresholds();
  const n = heartsShown(props);
  if (!ts || n == null) return null;
  const keep = Math.max(0, n - REFILL_HEARTS);
  if (!keep) return 0;
  const goal = Number(props.goal) || 0;
  const fill = (ts[keep - 1] + ts[keep]) / 2;
  return Math.min(toAmount(props.amount), amountAt(fill, goal, Number(props.softScale) || 0));
}

// The jar on the page, after a gift: it dips (out of sight - lowering never
// animates) and the hearts fall back in on the next frame. Not with reduced
// motion, where nothing would be seen.
export function replayJar(jar, props) {
  if (!jar || calm()) return false;
  const to = toAmount(props.amount);
  const from = refillFrom(props);
  if (from == null || from >= to) return false;
  jar.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
  jar.setAmount(from);
  requestAnimationFrame(() => setJarAmount(jar, to));
  return true;
}

function HeartJar({ amount, goal, softScale, animateOnLoad, isStatic, keepSize, on }) {
  const ref = useRef(null);
  // The element reads its attributes the moment it is put on the page.
  const [first] = useState(() => ({ amount: toAmount(amount), goal: attrText(goal), softScale: attrText(softScale) }));

  // Its events, before anything it says can be missed; removed with it.
  useLayoutEffect(() => {
    const jar = ref.current;
    const settled = (e) => on.current.onSettled?.(e.detail);
    const reached = (e) => on.current.onGoalReached?.(e.detail);
    jar.addEventListener('heartjar:settled', settled);
    jar.addEventListener('heartjar:goalreached', reached);
    on.current.onReady?.(jar);
    return () => {
      jar.removeEventListener('heartjar:settled', settled);
      jar.removeEventListener('heartjar:goalreached', reached);
    };
  }, [on]);

  // New numbers, through the ref - only when they change: not on mount (the
  // attributes already say them), and not over an amount the page has just
  // given the jar itself (the email link's next frame). Giving it the same
  // amount twice would start its spill over again.
  const last = useRef(first);
  useEffect(() => {
    const jar = ref.current;
    const prev = last.current;
    const next = { amount: toAmount(amount), goal: attrText(goal), softScale: attrText(softScale) };
    last.current = next;
    if (next.softScale !== prev.softScale) setAttr(jar, 'soft-scale', next.softScale);
    if (next.goal !== prev.goal) setAttr(jar, 'goal', next.goal);
    if (next.amount !== prev.amount && jar.amount !== next.amount) setJarAmount(jar, next.amount);
  }, [amount, goal, softScale]);

  return (
    <heart-jar
      ref={ref}
      amount={String(first.amount)}
      goal={first.goal ?? undefined}
      soft-scale={first.softScale ?? undefined}
      animate-on-load={animateOnLoad ? '' : undefined}
      static={isStatic ? '' : undefined}
      keep-size={keepSize ? '' : undefined}
      aria-hidden="true"
    />
  );
}

export default function GivingJar({
  amount = 0, goal = null, softScale = null, animateOnLoad = false, isStatic = false, keepSize = false,
  lazy = false, backdrop = false, shape = 'jar', label = 'The donation jar', className = '',
  onReady, onSettled, onGoalReached,
}) {
  const box = useRef(null);
  const [defined, setDefined] = useState(false);
  const [wanted, setWanted] = useState(!lazy); // load the scripts
  const [shown, setShown] = useState(!lazy); // put the jar on the page
  const on = useRef({});
  on.current = { onReady, onSettled, onGoalReached };

  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    loadHeartJar().then(() => { if (alive) setDefined(true); }).catch(() => { /* the empty box stays */ });
    return () => { alive = false; };
  }, [wanted]);

  // Lazy: the scripts start loading well before it is reached; the jar goes
  // on the page just before it is (still jars), or once it is well in view
  // (jars whose hearts fall in as it appears).
  useEffect(() => {
    if (shown) return undefined;
    const node = box.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setWanted(true); setShown(true); return undefined; }
    const early = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { early.disconnect(); setWanted(true); }
    }, { rootMargin: '800px 0px' });
    const now = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { now.disconnect(); setWanted(true); setShown(true); }
    }, animateOnLoad && !isStatic ? { threshold: 0.4 } : { rootMargin: '240px 0px' });
    early.observe(node);
    now.observe(node);
    return () => { early.disconnect(); now.disconnect(); };
  }, [shown, animateOnLoad, isStatic]);

  const classes = ['gj', shape === 'square' ? 'is-square' : '', backdrop ? 'has-art' : '', className].filter(Boolean).join(' ');
  return (
    <div ref={box} className={classes} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
      {backdrop && (
        <span className="gj-art" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
      )}
      {defined && shown ? (
        <HeartJar amount={amount} goal={goal} softScale={softScale} animateOnLoad={animateOnLoad} isStatic={isStatic} keepSize={keepSize} on={on} />
      ) : (
        <span className="gj-wait" />
      )}
    </div>
  );
}
