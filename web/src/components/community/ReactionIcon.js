'use client';

// The Community Hub's reactions as pictures instead of emoji: custom 3D icons
// in public/Community-Hub, one set for light mode and one for dark, each in a
// static "active" (picked) and "inactive" state, plus an animated version that
// plays once when a reaction is picked. Love = heart, Fire = fire, Praise =
// hands. How a reaction is saved or counted is not this file's business.

const BASE = '/Community-Hub';
const FILE = { heart: 'heart', fire: 'fire', praise: 'hands' };
export const REACTION_TYPES = ['heart', 'fire', 'praise'];
// How long the animated picture shows before the static active one returns.
export const REACTION_PLAY_MS = 1200;

const fileName = (type) => FILE[type] || FILE.heart;

/** The static icon: /Community-Hub/reaction-heart-light-active.svg, ... */
export const reactionIconSrc = (type, { dark = false, active = false } = {}) => (
  `${BASE}/reaction-${fileName(type)}-${dark ? 'dark' : 'light'}-${active ? 'active' : 'inactive'}.svg`
);
const animatedSrc = (type, dark) => `${BASE}/animated-${fileName(type)}-${dark ? 'dark' : 'light'}.svg`;

// The animated files' text, fetched once by preloadReactionIcons(). Every play
// gets its own blob: URL made from that text, so the animation starts over on
// every click with nothing to download. (A "?t=<time>" URL also restarts it,
// but as a new address it skips the preload and shows nothing while it loads;
// it is only the fallback until the text has arrived.)
const animatedText = new Map();
let preloaded = false;

/** Fetch the animated icons and warm the active ones, once per page. */
export function preloadReactionIcons() {
  if (preloaded || typeof window === 'undefined') return;
  preloaded = true;
  REACTION_TYPES.forEach((type) => [false, true].forEach((dark) => {
    const img = new Image();
    img.src = reactionIconSrc(type, { dark, active: true });
    const url = animatedSrc(type, dark);
    fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      // Only a real SVG is kept: anything else (an error page) would show
      // as a broken picture, so the ?t= fallback is used instead.
      .then((text) => { if (text && text.includes('<svg')) animatedText.set(url, text); })
      .catch(() => { /* the ?t= fallback still works */ });
  }));
}

export const prefersReducedMotion = () => (
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
);

/** A fresh animated picture for one play: { src, release } (release frees it). */
export function reactionPlaySrc(type, dark) {
  const url = animatedSrc(type, dark);
  const text = animatedText.get(url);
  if (text && typeof URL !== 'undefined' && URL.createObjectURL) {
    const src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    return { src, release: () => URL.revokeObjectURL(src) };
  }
  return { src: `${url}?t=${Date.now()}`, release: () => {} };
}

/**
 * One reaction icon. Decorative (alt="", aria-hidden): the button around it
 * carries the name. `src` overrides the static file (the animated play).
 */
export function ReactionIcon({ type, dark = false, active = false, src, size = 22, className = '' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`rx-ico ${className}`.trim()}
      src={src || reactionIconSrc(type, { dark, active })}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** Ten gold dots bursting out of an icon as a reaction is picked (.rx-burst). */
export function ReactionBurst() {
  return (
    <span className="rx-burst" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--rx-a': `${i * 36}deg` }} />)}
    </span>
  );
}
