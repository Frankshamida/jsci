'use client';

// A Midweek Service thumbnail (lib/midweekThumbnails), drawn from the service's
// own title, date and speaker - never a stored picture, so a renamed service
// shows its new title everywhere at once. Drawn once Outfit has loaded, so the
// title is measured and broken into lines with the real font, and redrawn if
// fonts finish loading later. Until then, the template's dark ground.

import { useMemo } from 'react';
import { inlineThumbnail, useOutfitReady } from '@/lib/midweekThumbnailClient';
import './midweekThumbnail.css';

export default function MidweekThumbnail({
  template = 'spotlight',
  title,
  date,
  speaker,
  label,
  showPlayIcon = true,
  className = '',
}) {
  const fonts = useOutfitReady();
  const svg = useMemo(
    () => (fonts ? inlineThumbnail(template, { title, date, speaker: speaker || '', label }, { showPlayIcon }) : ''),
    [fonts, template, title, date, speaker, label, showPlayIcon],
  );
  return (
    <span
      className={`mwt mwt-${template} ${svg ? 'is-drawn' : ''} ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
