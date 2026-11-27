'use client';

// The jar and the gold bar on a giving card (components/giving/GivingCard),
// which is drawn on the server for News: this part runs in the browser, so the
// hearts and the bar fill together as the card scrolls into view.

import GivingJar from './GivingJar';
import { useJarMeter } from './useJarMeter';
import { campaignProgress, jarProps, peso } from '@/lib/giving';

export default function GivingFill({ campaign }) {
  const { raised, goal, percent, gifts } = campaignProgress(campaign);
  const meter = useJarMeter(percent != null ? Math.max(percent, raised > 0 ? 3 : 0) : 0);
  return (
    <div className="gvc-fill">
      <div className="gvc-stage">
        <GivingJar {...jarProps(campaign)} shape="square" backdrop animateOnLoad lazy label="" onReady={meter.onJarReady} />
      </div>
      <div className="gvc-fill-info">
        {percent != null ? (
          <span className="gvc-progress">
            <span className="gvc-bar" aria-hidden="true" ref={meter.barRef}><span style={meter.fillStyle}></span></span>
            <span className="gvc-raised"><strong>{peso(raised)}</strong> raised of {peso(goal)}</span>
          </span>
        ) : gifts > 0 ? (
          <span className="gvc-raised"><strong>{peso(raised)}</strong> from {gifts} {gifts === 1 ? 'donation' : 'donations'}</span>
        ) : (
          <span className="gvc-raised">Be the first to give</span>
        )}
        <span className="gvc-cta">Donate</span>
      </div>
    </div>
  );
}
