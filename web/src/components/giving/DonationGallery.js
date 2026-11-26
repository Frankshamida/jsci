'use client';

// A donation drive's photos (up to 8): one large, the rest as small ones to
// choose from. Arrows, the arrow keys and a swipe move between them.

import { useRef, useState } from 'react';

export default function DonationGallery({ images = [], title = '' }) {
  const [at, setAt] = useState(0);
  const touch = useRef(null);
  if (!images.length) return null;
  const n = images.length;
  const go = (i) => setAt((i + n) % n);
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
  };
  return (
    <div className="gv-gallery" role="region" aria-roledescription="carousel" aria-label={`Photos of ${title}`} tabIndex={n > 1 ? 0 : undefined} onKeyDown={n > 1 ? onKey : undefined}>
      <div
        className="gv-gallery-main"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1));
        }}
      >
        {images.map((src, i) => (
          <img key={src} src={src} alt={i === at ? `${title}, photo ${i + 1} of ${n}` : ''} className={i === at ? 'on' : ''} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" aria-hidden={i === at ? undefined : 'true'} />
        ))}
        {n > 1 && (
          <>
            <button type="button" className="gv-gallery-arrow is-prev" onClick={() => go(at - 1)} aria-label="Previous photo">‹</button>
            <button type="button" className="gv-gallery-arrow is-next" onClick={() => go(at + 1)} aria-label="Next photo">›</button>
            <span className="gv-gallery-count" aria-hidden="true">{at + 1} / {n}</span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="gv-gallery-thumbs">
          {images.map((src, i) => (
            <button key={src} type="button" className={i === at ? 'on' : ''} onClick={() => go(i)} aria-label={`Photo ${i + 1}`} aria-current={i === at ? 'true' : undefined}>
              <img src={src} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
