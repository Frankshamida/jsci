'use client';

/* ============================================================
   The looping clip behind the hero, when the hero is set to video.

   A background video is the easiest way to make a landing page feel slow, and
   almost none of that is the file size - it is that the browser goes on
   decoding frames forever. A 1080p loop decoding while somebody reads the
   events section three screens down is a core of CPU doing nothing anybody can
   see, and on a mid-range phone that is exactly what turns smooth scrolling
   into jerky scrolling. So the rules here are:

     - it plays only while it is on screen (IntersectionObserver)
     - it stops when the tab is in the background
     - it never plays for somebody who asked for less motion, or whose browser
       says they are on a metered or slow connection - they get the poster,
       which is the carousel's own first photo and is already being preloaded
     - the poster is visible from the first paint and the video fades over it
       once it can actually play, so there is no black rectangle in between

   None of that helps if the file itself is enormous. See the note in the admin
   form: a hero loop wants to be a couple of megabytes, not fifty.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';

// A connection the visitor would rather we did not spend. `connection` is
// Chromium-only; everywhere else this is simply false and the video plays.
const connectionIsExpensive = () => {
  const c = typeof navigator !== 'undefined'
    && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
  if (!c) return false;
  if (c.saveData) return true;
  return ['slow-2g', '2g', '3g'].includes(c.effectiveType);
};

export default function HeroVideo({ src, poster }) {
  const videoRef = useRef(null);
  // Starts false so the poster is what paints first, whatever happens next.
  const [ready, setReady] = useState(false);
  // A file the browser cannot decode. The case that matters is H.265/HEVC,
  // which phones record natively and which Safari plays and Firefox does not -
  // so a clip that looks perfect to whoever uploaded it can be a dead black
  // rectangle for half the congregation. Falling back to the poster means the
  // worst case is the hero the site had before.
  const [broken, setBroken] = useState(false);
  // Decided on the client only: reading either of these during render would
  // disagree with the server's HTML.
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    setAllowed(!reduced && !connectionIsExpensive());
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || allowed !== true) return undefined;

    // Autoplay is refused often enough - a phone in low-power mode, a browser
    // setting - that it has to be treated as normal rather than as an error.
    // The poster simply stays.
    const tryPlay = () => { const p = el.play(); if (p?.catch) p.catch(() => {}); };

    let onScreen = true;
    const sync = () => {
      if (onScreen && !document.hidden) tryPlay();
      else el.pause();
    };

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    }, { threshold: 0.01 });
    io.observe(el);

    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [allowed, src]);

  // Not yet decided, decided against, or unplayable: the poster does the whole
  // job. It is drawn as a plain <img> so it behaves exactly like a carousel
  // slide.
  if (allowed !== true || broken) {
    return <img src={poster} alt="" className="hp-hero-slide-img" aria-hidden="true" />;
  }

  return (
    <video
      ref={videoRef}
      className={`hp-hero-video ${ready ? 'ready' : ''}`}
      // muted + playsInline are what make autoplay legal on a phone at all;
      // without them iOS refuses and shows a play button over the hero.
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster={poster}
      disablePictureInPicture
      // Decorative: the hero's words are in the overlay above it.
      aria-hidden="true"
      tabIndex={-1}
      onCanPlay={() => setReady(true)}
      // Fires on a network failure and on a codec the browser will not decode.
      onError={() => setBroken(true)}
    >
      <source src={src} type="video/mp4" onError={() => setBroken(true)} />
    </video>
  );
}
