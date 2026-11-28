'use client';

// The "Welcome to SanctuaryHub" window's content: the school and church
// logos, the badge, the headline, the description, the developers' cards and
// the "Enter SanctuaryHub" button. Drawn from the design in
// public/developer-templates (sanctuaryhub-developers-light/dark.svg).
//
// It follows the site's theme (body.dark-mode) unless `theme` names one,
// which the admin preview does. The overlay, focus and keyboard handling are
// DeveloperWelcomeHost's; the preview in Dashboard > Developers draws this
// inline.

import { useId } from 'react';
import { roleIconFa, splitHeadline, DEFAULT_DEV_SETTINGS } from '@/lib/developers';
import './developers.css';

const LOGOS = '/developer-templates';

// The abstract behind everything: soft colour fields, gold ribbons sweeping
// across the bottom and in from the top right, faint rings in two corners.
function Backdrop() {
  const uid = useId().replace(/:/g, '');
  const g = (n) => `dw-${uid}-${n}`;
  const stop = (v, o = 1) => ({ stopColor: `var(${v})`, stopOpacity: o });
  return (
    <svg className="dw-art" viewBox="0 0 1200 820" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={g('a')}><stop offset="0" style={stop('--dw-f1')} /><stop offset="1" style={stop('--dw-f1', 0)} /></radialGradient>
        <radialGradient id={g('b')}><stop offset="0" style={stop('--dw-f2')} /><stop offset="1" style={stop('--dw-f2', 0)} /></radialGradient>
        <radialGradient id={g('c')}><stop offset="0" style={stop('--dw-f3')} /><stop offset="1" style={stop('--dw-f3', 0)} /></radialGradient>
      </defs>
      <circle cx="600" cy="-60" r="560" fill={`url(#${g('a')})`} />
      <circle cx="1120" cy="170" r="460" fill={`url(#${g('b')})`} />
      <circle cx="90" cy="430" r="380" fill={`url(#${g('b')})`} opacity="0.7" />
      <circle cx="260" cy="860" r="460" fill={`url(#${g('c')})`} />
      <circle cx="1000" cy="880" r="420" fill={`url(#${g('a')})`} opacity="0.6" />
      <g className="dw-rings">
        {[150, 200, 250, 300, 350, 400].map((r) => <circle key={`tl${r}`} cx="0" cy="0" r={r} />)}
        {[150, 200, 250, 300, 350].map((r) => <circle key={`br${r}`} cx="1200" cy="820" r={r} />)}
      </g>
      <g className="dw-ribbons">
        {Array.from({ length: 9 }, (_, i) => (
          <path key={`b${i}`} d={`M-60 ${640 + i * 14} C 260 ${560 + i * 16}, 620 ${830 - i * 8}, 1260 ${560 + i * 18}`} style={{ opacity: 0.35 + (i % 3) * 0.22 }} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <path key={`t${i}`} d={`M ${760 + i * 26} -20 C ${900 + i * 20} ${90 + i * 10}, ${1040 + i * 8} ${140 + i * 14}, 1260 ${190 + i * 22}`} style={{ opacity: 0.3 + (i % 2) * 0.3 }} />
        ))}
      </g>
    </svg>
  );
}

// A person, for a developer with no photo yet.
function Silhouette() {
  return (
    <svg className="dw-silhouette" viewBox="0 0 246 352" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <circle cx="123" cy="134" r="46" />
      <path d="M 18 352 C 18 268, 62 214, 123 214 C 184 214, 228 268, 228 352 Z" />
    </svg>
  );
}

/** One developer's card: the photo fills it; a glass panel carries the name. */
export function DeveloperCard({ dev }) {
  return (
    <li className="dw-card">
      <div className="dw-card-frame">
        {dev.photoUrl
          ? <img className="dw-photo" src={dev.photoUrl} alt="" width={700} height={1000} decoding="async" draggable={false} />
          : <Silhouette />}
        <span className="dw-scrim" aria-hidden="true"></span>
        <div className="dw-glass">
          <b className="dw-surname">{dev.surname}</b>
          {dev.givenNames && <span className="dw-given">{dev.givenNames}</span>}
          {dev.role && (
            <span className="dw-role"><i className={`fas ${roleIconFa(dev.roleIcon)}`} aria-hidden="true"></i>{dev.role}</span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * @param {object[]} developers  the active developers, in order
 * @param {object}   settings    { badge, headline, description }
 * @param {string}   status      'ready' | 'loading' | 'error'
 * @param {Function} onClose     the X and "Enter SanctuaryHub"
 * @param {string}   theme       'light' | 'dark' to fix one; else the site's
 * @param {string}   titleId     the headline's id (the dialog is labelled by it)
 * @param {boolean}  optOut / onOptOut  the "Don't show this again" box (left out when onOptOut is not given)
 */
export default function DeveloperWelcome({
  developers = [], settings, status = 'ready', error = '', onRetry, onClose, theme, titleId, platform = 'SanctuaryHub',
  optOut = false, onOptOut, inline = false, closeRef, enterRef,
}) {
  const words = { ...DEFAULT_DEV_SETTINGS, ...(settings || {}) };
  const [before, gold, after] = splitHeadline(words.headline, platform);
  const n = Math.max(1, developers.length);

  let cards;
  if (status === 'loading' || status === 'idle') {
    cards = (
      <ul className="dw-cards" style={{ '--dw-n': 4, '--dw-n2': 2 }} aria-busy="true" aria-label="Loading the team">
        {[0, 1, 2, 3].map((i) => <li key={i} className="dw-card is-skeleton"><div className="dw-card-frame"></div></li>)}
      </ul>
    );
  } else if (status === 'error') {
    cards = (
      <div className="dw-state" role="alert">
        <i className="fas fa-cloud-arrow-down" aria-hidden="true"></i>
        <p>We couldn&apos;t load the team just now.</p>
        {onRetry && <button type="button" className="dw-retry" onClick={onRetry}>Try again</button>}
        {error && <small>{error}</small>}
      </div>
    );
  } else if (!developers.length) {
    cards = (
      <div className="dw-state">
        <i className="fas fa-users" aria-hidden="true"></i>
        <p>The team will be introduced here soon.</p>
      </div>
    );
  } else {
    cards = (
      <ul className={`dw-cards${n >= 5 ? ' is-many' : ''}`} style={{ '--dw-n': n, '--dw-n2': Math.min(n, 2) }} aria-label="The developers">
        {developers.map((d) => <DeveloperCard key={d.id} dev={d} />)}
      </ul>
    );
  }

  return (
    <div className={`dw${inline ? ' is-inline' : ''}`} data-theme={theme || undefined}>
      <span className="dw-bar" aria-hidden="true"></span>
      <Backdrop />
      <button type="button" className="dw-close" onClick={onClose} aria-label="Close" ref={closeRef}>
        <i className="fas fa-xmark" aria-hidden="true"></i>
      </button>
      <div className="dw-scroll">
        <div className="dw-logos">
          <img className="dw-logo dw-logo-uc is-light" src={`${LOGOS}/uc.png`} alt="University of Cebu" width={105} height={52} />
          <img className="dw-logo dw-logo-uc is-dark" src={`${LOGOS}/uc-white.png`} alt="University of Cebu" width={105} height={52} />
          <span className="dw-divider" aria-hidden="true"></span>
          <img className="dw-logo" src={`${LOGOS}/ccs.png`} alt="College of Computer Studies" width={51} height={52} />
          <span className="dw-divider" aria-hidden="true"></span>
          <img className="dw-logo" src={`${LOGOS}/jsci.png`} alt="Joyful Sound Church International" width={52} height={52} />
        </div>
        {words.badge && (
          <span className="dw-badge"><i className="fas fa-code" aria-hidden="true"></i>{words.badge}</span>
        )}
        <h2 className="dw-title" id={titleId}>
          {before}{gold && <span className="dw-gold">{gold}</span>}{after}
        </h2>
        {words.description && <p className="dw-desc">{words.description}</p>}
        {cards}
        <div className="dw-actions">
          <button type="button" className="dw-enter" onClick={onClose} ref={enterRef}>Enter {platform}</button>
          {onOptOut && (
            <label className="dw-optout">
              <input type="checkbox" checked={optOut} onChange={(e) => onOptOut(e.target.checked)} />
              <span>Don&apos;t show this again</span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
