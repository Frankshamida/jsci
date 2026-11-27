'use client';

// One donation drive on /donation: its jar, what it is for, and how far it
// has come. As the card scrolls into view the hearts fall into the jar and
// the gold bar fills with them, stopping together (useJarMeter).

import GivingJar from './GivingJar';
import { useJarMeter } from './useJarMeter';
import { campaignEnds, campaignPath, jarProps, peso } from '@/lib/giving';

export default function DriveCard({ c }) {
  const goal = Number(c.goal_amount) || 0;
  const percent = goal ? Math.round((c.raised / goal) * 100) : 0;
  const ends = campaignEnds(c);
  const meter = useJarMeter(Math.min(100, Math.max(percent, c.raised > 0 ? 2 : 0)));
  return (
    <a href={campaignPath(c.slug)} className="gv-card gv-drive">
      {c.image_url && (
        <div className="gv-drive-media" aria-hidden="true">
          <img src={c.image_url} alt="" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="gv-drive-body">
        <div className="gv-drive-jar" aria-hidden="true">
          <GivingJar {...jarProps(c)} animateOnLoad keepSize lazy label="" onReady={meter.onJarReady} />
        </div>
        <div className="gv-drive-text">
          <strong>{c.title}</strong>
          {c.summary && <span className="gv-drive-sum">{c.summary}</span>}
          {goal > 0 && <span className="gv-meter" aria-hidden="true" ref={meter.barRef}><span style={meter.fillStyle}></span></span>}
          <span className="gv-drive-amount">
            {c.raised > 0
              ? <><b>{peso(c.raised)}</b>{goal ? ` of ${peso(goal)}` : ` from ${c.gifts} ${c.gifts === 1 ? 'donation' : 'donations'}`}</>
              : 'Be the first to give'}
            {ends ? ` · ${ends}` : ''}
          </span>
        </div>
      </div>
    </a>
  );
}
