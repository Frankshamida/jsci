'use client';

// Dashboard > Giving (/giving-management; Admin and Super Admin), in two tabs
// built from the same pieces as Social Media (components/social/kit):
//
//   Gifts      every gift sent: confirm it once it is in the church's
//              account (the giver is emailed), mark it failed or refunded,
//              and record gifts given in person
//   Donation drives  what the church is asked to donate to: each on
//              /donation/<slug> with its photos and its jar, and, featured,
//              beside the News, in the Community Hub and on the home page
//
// It opens on the tab in the address (?tab=appeals), else the one last used.

import { useEffect, useRef, useState } from 'react';
import GiftsManager from './GiftsManager';
import CampaignsManager from './CampaignsManager';
import '@/components/social/social.css';
import './givingAdmin.css';

const TABS = [
  { key: 'gifts', label: 'Gifts' },
  { key: 'appeals', label: 'Donation drives' },
];
const KEY = 'givingAdminTab';

export default function GivingAdmin({ actorId }) {
  const [tab, setTab] = useState('gifts');
  const [pending, setPending] = useState(0);
  const refs = useRef({});

  useEffect(() => {
    let t = null;
    try { t = new URLSearchParams(window.location.search).get('tab'); } catch { /* none */ }
    if (!TABS.some((x) => x.key === t)) {
      try { t = localStorage.getItem(KEY); } catch { /* Gifts first */ }
    }
    if (TABS.some((x) => x.key === t)) setTab(t);
  }, []);

  const pick = (key, focus = false) => {
    setTab(key);
    try { localStorage.setItem(KEY, key); } catch { /* not kept */ }
    if (focus) refs.current[key]?.focus();
  };
  const onKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); pick(TABS[(i + step + TABS.length) % TABS.length].key, true); }
  };

  return (
    <div className="sm-theme sm">
      <div className="sm-tabs" role="tablist" aria-label="Giving">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { refs.current[t.key] = el; }}
            type="button"
            role="tab"
            id={`gvm-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`gvm-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={tab === t.key ? 'on' : ''}
            onClick={() => pick(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.key === 'gifts' && pending > 0 && <span className="gvm-tab-count" aria-label={`${pending} waiting`}>{pending}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`gvm-panel-${tab}`} aria-labelledby={`gvm-tab-${tab}`}>
        {tab === 'gifts'
          ? <GiftsManager actorId={actorId} onPending={setPending} />
          : <CampaignsManager actorId={actorId} />}
      </div>
    </div>
  );
}
