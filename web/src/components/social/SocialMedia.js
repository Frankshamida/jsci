'use client';

// Dashboard > Social Media (/social-media; Admin and Super Admin): the church's
// services on Facebook, in two tabs that work the same way -
//
//   Sunday Service    the Facebook Lives, played on /sunday-service
//   Midweek Service   the Facebook videos, listed on /midweek
//
// It opens on the tab in the address (/social-media?tab=midweek - the
// "Manage" button on those pages), else the one last used. The Sunday tab says
// "Live" while a service is live.

import { useEffect, useRef, useState } from 'react';
import SundayManager from './SundayManager';
import MidweekManager from './MidweekManager';
import './social.css';

const TABS = [
  { key: 'sunday', label: 'Sunday Service' },
  { key: 'midweek', label: 'Midweek Service' },
];
const KEY = 'socialMediaTab';
// What the tab was called before (Live & Videos: Facebook Live / Service Videos).
const OLD = { live: 'sunday', videos: 'midweek' };

export default function SocialMedia({ actorId }) {
  const [tab, setTab] = useState('sunday');
  const [live, setLive] = useState(false);
  const refs = useRef({});

  useEffect(() => {
    let t = null;
    try { t = new URLSearchParams(window.location.search).get('tab'); } catch { /* none */ }
    if (!TABS.some((x) => x.key === t)) {
      try { t = localStorage.getItem(KEY) || OLD[localStorage.getItem('liveMgmtTab')] || null; } catch { /* Sunday first */ }
    }
    if (TABS.some((x) => x.key === t)) setTab(t);
    fetch('/api/live-streams/public')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setLive(Array.isArray(list) && list.length > 0))
      .catch(() => { /* no badge */ });
  }, []);

  const pick = (key, focus = false) => {
    setTab(key);
    try { localStorage.setItem(KEY, key); } catch { /* not kept */ }
    if (focus) refs.current[key]?.focus();
  };

  const onKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); pick(TABS[(i + step + TABS.length) % TABS.length].key, true); }
    else if (e.key === 'Home') { e.preventDefault(); pick(TABS[0].key, true); }
    else if (e.key === 'End') { e.preventDefault(); pick(TABS[TABS.length - 1].key, true); }
  };

  return (
    <div className="sm-theme sm">
      <div className="sm-tabs" role="tablist" aria-label="Service">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { refs.current[t.key] = el; }}
            type="button"
            role="tab"
            id={`sm-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`sm-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={tab === t.key ? 'on' : ''}
            onClick={() => pick(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.key === 'sunday' && live && <span className="sm-tab-live"><span className="sm-dot" aria-hidden="true"></span> Live</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`sm-panel-${tab}`} aria-labelledby={`sm-tab-${tab}`}>
        {tab === 'sunday'
          ? <SundayManager actorId={actorId} onLiveChange={setLive} />
          : <MidweekManager actorId={actorId} />}
      </div>
    </div>
  );
}
