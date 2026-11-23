'use client';

// A row of photos shown one at a time. The arrows, the dots, a swipe or the
// arrow keys move it, and each photo slides smoothly into place. A photo is
// shown whole (a poster keeps its words) over a blurred copy of itself, and
// its caption and "See more" link sit underneath.

import { useCallback, useRef, useState } from 'react';
import { newsImage } from '@/lib/news';
import { ImageLink } from '@/components/news/ImageLink';

const SIZES = '(max-width: 1000px) 100vw, 980px';
const srcSet = (url) => [480, 760, 1200, 1600].map((w) => `${newsImage(url, w)} ${w}w`).join(', ');

export default function Carousel({ images = [] }) {
  const slides = images.filter((img) => img?.url);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef(null);
  const viewport = useRef(null);
  const count = slides.length;

  const go = useCallback((i) => setIndex(((i % count) + count) % count), [count]);

  if (!count) return null;
  const at = Math.min(index, count - 1);
  const current = slides[at];

  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
  };

  // Swipe: the photo follows the finger, and lets go to the next one past
  // a sixth of its width.
  const onDown = (e) => {
    if (count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(e.clientY - s.y) > Math.abs(dx)) { start.current = null; return; }
    if (Math.abs(dx) > 4) s.moved = true;
    setDrag(dx);
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const width = viewport.current?.offsetWidth || 1;
    if (drag < -width / 6) go(at + 1);
    else if (drag > width / 6) go(at - 1);
    setDrag(0);
  };

  return (
    <figure className="na-carousel" aria-roledescription="carousel" aria-label="Photos">
      <div
        ref={viewport}
        className={`na-carousel-view ${drag ? 'is-dragging' : ''}`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { if (start.current) onUp(); }}
      >
        <div
          className="na-carousel-track"
          style={{ transform: `translate3d(calc(${-at * 100}% + ${drag}px), 0, 0)` }}
        >
          {slides.map((img, i) => (
            <div
              key={`${img.url}-${i}`}
              className="na-carousel-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== at}
            >
              <span className="na-carousel-blur" style={{ backgroundImage: `url("${newsImage(img.url, 120)}")` }} aria-hidden="true" />
              <img
                src={newsImage(img.url, 1200)}
                srcSet={srcSet(img.url)}
                sizes={SIZES}
                alt={img.alt || img.caption || ''}
                loading={Math.abs(i - at) <= 1 ? 'eager' : 'lazy'}
                decoding="async"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {count > 1 && (
          <>
            <button type="button" className="na-carousel-arrow prev" onClick={() => go(at - 1)} aria-label="Previous photo">
              <i className="fas fa-chevron-left" aria-hidden="true"></i>
            </button>
            <button type="button" className="na-carousel-arrow next" onClick={() => go(at + 1)} aria-label="Next photo">
              <i className="fas fa-chevron-right" aria-hidden="true"></i>
            </button>
            <span className="na-carousel-count" aria-live="polite">{at + 1} / {count}</span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="na-carousel-dots">
          {slides.map((img, i) => (
            <button
              key={`dot-${img.url}-${i}`}
              type="button"
              className={i === at ? 'on' : ''}
              onClick={() => go(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === at}
            />
          ))}
        </div>
      )}

      {(current.caption || current.link) && (
        <figcaption key={at} className="na-carousel-caption">
          {current.caption && <span>{current.caption}</span>}
          <ImageLink image={current} />
        </figcaption>
      )}
    </figure>
  );
}
