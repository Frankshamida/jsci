'use client';

// The landing page's Give section: the newest featured donation drive - its
// jar of hearts, what it is for, its photos, then Donate. Read in the browser
// (/api/giving?featured=1, newest first, confirmed donations only); with no
// drive open the section is left out. Tithes and offerings are given on the
// Sunday Service page (the navbar's Give menu, and the footer).
//
// The jar's hearts fall in as it scrolls into view. Donating here, the window
// closes onto the jar and its hearts drop in again for the giver.

import { useRef } from 'react';
import GivingJar, { replayJar } from './GivingJar';
import { useJarMeter } from './useJarMeter';
import { GiveButton } from './GiveModal';
import { useFeaturedCampaigns } from '@/lib/givingClient';
import { campaignEnds, campaignPath, campaignProgress, jarProps, peso } from '@/lib/giving';
import './giveShowcase.css';

const MAX_PHOTOS = 3;

export default function GiveShowcase() {
  const campaigns = useFeaturedCampaigns();
  const jarEl = useRef(null);
  const box = useRef(null);
  const drive = campaigns?.[0] || null;
  // The gold bar fills with the jar's hearts and stops with them. (Asked for
  // before the early return below: a hook is never skipped.)
  const progress = drive ? campaignProgress(drive) : null;
  const meter = useJarMeter(progress?.percent != null ? Math.min(100, Math.max(progress.percent, progress.raised > 0 ? 2 : 0)) : 0);
  if (!drive) return null;

  const { raised, goal, gifts } = progress;
  const ends = campaignEnds(drive);
  const all = drive.images?.length ? drive.images : drive.image_url ? [drive.image_url] : [];
  const photos = all.slice(0, MAX_PHOTOS);
  const more = all.length - photos.length;
  const href = campaignPath(drive.slug);
  const reached = goal > 0 && raised >= goal;
  const label = raised ? `The donation jar: ${peso(raised)}${goal ? ` of ${peso(goal)}` : ''}` : 'The donation jar, empty so far';

  const onGiven = () => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => replayJar(jarEl.current, jarProps(drive)), calm ? 0 : 450);
  };

  return (
    <section id="give" className="hp-section hp-give gvs" aria-labelledby="gvs-title">
      <div ref={box} className={`gvs-card ${photos.length ? '' : 'no-photos'}`}>
        <div className="gvs-jar">
          <GivingJar {...jarProps(drive)} backdrop animateOnLoad lazy label={label} onReady={(j) => { jarEl.current = j; meter.onJarReady(j); }} />
        </div>

        <div className="gvs-details">
          <span className="gvs-eyebrow">Donate{ends ? <span className="gvs-ends"> · {ends}</span> : null}</span>
          <h2 id="gvs-title"><a href={href}>{drive.title}</a></h2>
          {drive.summary && <p className="gvs-summary">{drive.summary}</p>}
          <div className="gvs-amount">
            <strong>{peso(raised)}</strong>
            <span>
              {goal
                ? `raised of ${peso(goal)}`
                : gifts ? `from ${gifts} ${gifts === 1 ? 'donation' : 'donations'}` : 'Be the first to give'}
            </span>
          </div>
          {goal > 0 && (
            <div className="gvs-meter" aria-hidden="true" ref={meter.barRef}>
              <span style={meter.fillStyle}></span>
            </div>
          )}
          {reached && <p className="gvs-reached">Goal reached - thank you!</p>}
        </div>

        {photos.length > 0 && (
          <a href={href} className={`gvs-photos is-${photos.length}`} aria-label={`Photos of ${drive.title}`}>
            {photos.map((src, i) => (
              <span key={src} className="gvs-photo">
                <img src={src} alt="" loading="lazy" decoding="async" />
                {i === photos.length - 1 && more > 0 && <span className="gvs-more">+{more}</span>}
              </span>
            ))}
          </a>
        )}

        <div className="gvs-action">
          <GiveButton mode="donation" campaign={drive} className="gvs-donate" onGiven={onGiven}>Donate</GiveButton>
          <a href={href} className="gvs-link">See the drive</a>
        </div>
      </div>
    </section>
  );
}
