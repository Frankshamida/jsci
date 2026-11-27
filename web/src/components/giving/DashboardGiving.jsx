'use client';

// Dashboard > Give: tithes and offerings, the donation drives and My giving,
// inside the dashboard (with its sidebar), for everyone signed in. The same
// giving window as the public pages (GiveModal) does the giving.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GiveButton } from './GiveModal';
import GivingJar from './GivingJar';
import MyGiving from './MyGiving';
import { useJarMeter } from './useJarMeter';
import { jarProps, peso, campaignEnds, verseFor } from '@/lib/giving';
import { GIVE_TABS } from './giveTabs';
import './giving.css';
import './dashboardGiving.css';

function Tithes() {
  // A verse for the day: the same one all day, another tomorrow.
  const verse = verseFor(new Date().toDateString());
  return (
    <section className="dg-tithes gv-card" aria-labelledby="dg-tithes-title">
      <img src="/heart-jar/gold-hearts/heart-gold.png" alt="" className="dg-tithes-heart" aria-hidden="true" />
      <div className="dg-tithes-text">
        <h3 id="dg-tithes-title">Tithes &amp; Offering</h3>
        <p>Give by GCash, Maya or bank transfer. You get a receipt once the treasurer confirms it, and it shows in My giving.</p>
        {verse && (
          <blockquote className="dg-verse">
            &ldquo;{verse.text}&rdquo;<cite>{verse.ref}</cite>
          </blockquote>
        )}
      </div>
      <GiveButton mode="tithes" className="gv-btn is-primary dg-give-btn">Give tithes or offering</GiveButton>
    </section>
  );
}

// What a drive has raised, in words: "₱15,000 of ₱50,000 · Ends Dec 31".
function Raised({ c }) {
  const goal = Number(c.goal_amount) || 0;
  const ends = campaignEnds(c);
  return (
    <>
      {c.raised > 0
        ? <><b>{peso(c.raised)}</b>{goal ? ` of ${peso(goal)}` : ` from ${c.gifts} ${c.gifts === 1 ? 'donation' : 'donations'}`}</>
        : 'Be the first to give'}
      {ends ? ` · ${ends}` : ''}
    </>
  );
}
const barPercent = (c) => {
  const goal = Number(c.goal_amount) || 0;
  return goal ? Math.min(100, Math.max(Math.round((c.raised / goal) * 100), c.raised > 0 ? 2 : 0)) : null;
};

// A drive's card: its picture, what it is for, and its gold bar, which fills
// as the card comes into view. No jar here: the jar is in its story.
function Drive({ c, onGiven, onStory }) {
  const percent = barPercent(c);
  const meter = useJarMeter(percent ?? 0, { withJar: false });
  return (
    <article className="dg-drive gv-card">
      {c.image_url && <img className="dg-drive-cover" src={c.image_url} alt="" loading="lazy" decoding="async" />}
      <div className="dg-drive-text">
        <h3>{c.title}</h3>
        {c.summary && <p className="dg-drive-sum">{c.summary}</p>}
        {percent != null && (
          <span className="gv-meter" role="img" aria-label={`${percent}% of the goal`} ref={meter.barRef}>
            <span style={meter.fillStyle}></span>
          </span>
        )}
        <p className="dg-drive-amount"><Raised c={c} /></p>
      </div>
      <div className="dg-drive-actions">
        <GiveButton mode="donation" campaign={c} className="gv-btn is-primary" onGiven={onGiven}>Donate</GiveButton>
        <button type="button" className="gv-btn" onClick={(e) => onStory(c, e.currentTarget)}>
          <i className="fas fa-book-open" aria-hidden="true"></i> Read the story
        </button>
      </div>
    </article>
  );
}

// The drive's story, in a window: its jar fills with hearts as it opens, and
// the gold bar with it (useJarMeter), then the photos and the whole story.
function DriveStory({ c, onClose, onGiven }) {
  const percent = barPercent(c);
  const meter = useJarMeter(percent ?? 0);
  const closeRef = useRef(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  const [photo, setPhoto] = useState(0);
  const photos = (c.images?.length ? c.images : c.image_url ? [c.image_url] : []).slice(0, 8);

  // Opened once: focus in, Escape closes it (not while the giving window,
  // opened from here, is on top of it), the page behind stays still.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.gv-modal-root')) closeFn.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, []);

  return createPortal(
    <div className="dg-story-root gv-theme" role="presentation" onClick={onClose}>
      <div className="dg-story" role="dialog" aria-modal="true" aria-labelledby="dg-story-title" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className="gv-x" onClick={onClose} aria-label="Close">×</button>
        <div className="dg-story-jar">
          <GivingJar {...jarProps(c)} animateOnLoad backdrop keepSize label={c.raised ? `The donation jar: ${peso(c.raised)}` : 'The donation jar, empty so far'} onReady={meter.onJarReady} />
        </div>
        <div className="dg-story-body">
          <span className="gv-eyebrow">Donation drive</span>
          <h3 id="dg-story-title">{c.title}</h3>
          <p className="dg-story-amount"><Raised c={c} /></p>
          {percent != null && (
            <span className="gv-meter dg-story-meter" role="img" aria-label={`${percent}% of the goal`} ref={meter.barRef}>
              <span style={meter.fillStyle}></span>
            </span>
          )}
          {c.summary && <p className="dg-story-sum">{c.summary}</p>}
          {photos.length > 0 && (
            <div className="dg-story-photos">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="dg-story-photo" src={photos[photo]} alt="" />
              {photos.length > 1 && (
                <div className="dg-story-thumbs" role="group" aria-label="Photos">
                  {photos.map((src, i) => (
                    <button key={src} type="button" className={`dg-thumb ${i === photo ? 'is-on' : ''}`} onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1} of ${photos.length}`} aria-pressed={i === photo}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {c.story && <p className="dg-story-text">{c.story}</p>}
          <div className="dg-story-actions">
            <GiveButton mode="donation" campaign={c} className="gv-btn is-primary" onGiven={onGiven}>Donate</GiveButton>
            <button type="button" className="gv-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Donations() {
  const [drives, setDrives] = useState(null);
  const [error, setError] = useState('');
  const [story, setStory] = useState(null); // { c, opener }
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/giving', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The donation drives could not be loaded.');
      setDrives(json.campaigns || []);
      setError('');
    } catch (e) { setError(e.message); setDrives((d) => d || []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (drives === null) return <div className="dg-loading"><span className="gv-spinner" aria-label="Loading"></span></div>;
  return (
    <>
      {error && <p className="dg-error" role="alert">{error} <button type="button" className="gv-btn is-small" onClick={load}>Try again</button></p>}
      {drives.length === 0 && !error ? (
        <section className="gv-card dg-empty">
          <GivingJar amount={0} isStatic label="An empty jar" />
          <h3>No donation drive right now</h3>
          <p>When the church starts one, it shows here with its jar.</p>
        </section>
      ) : (
        <div className="dg-drives">
          {drives.map((c) => <Drive key={c.id} c={c} onGiven={load} onStory={(drive, opener) => setStory({ c: drive, opener })} />)}
        </div>
      )}
      {story && (
        <DriveStory c={drives.find((d) => d.id === story.c.id) || story.c} onGiven={load}
          onClose={() => { const back = story.opener; setStory(null); back?.focus?.(); }} />
      )}
    </>
  );
}

export default function DashboardGiving({ tab, onTab }) {
  return (
    <div className="dg gv-theme">
      {/* The dashboard's own page title, as on every other page. */}
      <h2 className="section-title">Give</h2>
      <p className="dg-sub">Tithes, offerings and donations, by GCash, Maya or bank transfer. The money goes straight to the church&rsquo;s own accounts.</p>
      <nav className="dg-tabs" aria-label="Give">
        {GIVE_TABS.map((t) => (
          <button key={t.id} type="button" className={`dg-tab ${tab === t.id ? 'is-on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
            <i className={`fas ${t.icon}`} aria-hidden="true"></i>{t.label}
          </button>
        ))}
      </nav>
      {tab === 'tithes' && <Tithes />}
      {tab === 'donations' && <Donations />}
      {tab === 'my' && <div className="dg-my"><MyGiving onGive={(kind) => onTab(kind === 'donation' ? 'donations' : 'tithes')} /></div>}
    </div>
  );
}
