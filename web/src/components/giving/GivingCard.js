// The giving card - a donation drive, shown like a quiet advertisement beside
// a News article and in the Community Hub. The whole card is one link to the
// drive's page (/donation/<slug>). Beside its progress stands its jar of
// hearts (components/giving/GivingJar), which fills as the card scrolls into
// view - from the server's numbers, confirmed donations only.
//
// With no drive it invites to donate in general and links to /donation, with
// an empty jar for a picture.
//
//   variant  'rail'    the narrow column beside an article (picture on top)
//            'inline'  across the width (picture beside the words)
//            'hub'     the Community Hub's side column (smaller)
//
// No hooks: drawn on the server for News, in the browser for the others.

import GivingJar from './GivingJar';
import { campaignEnds, campaignPath, campaignProgress, jarProps, peso, DONATION_PATH } from '@/lib/giving';
import './givingCard.css';

export default function GivingCard({ campaign = null, variant = 'rail', preview = false }) {
  // In the dashboard's window it is a picture of the card, not a link.
  const Tag = preview ? 'div' : 'a';
  if (!campaign) {
    return (
      <Tag href={preview ? undefined : DONATION_PATH} className={`gvc gvc-${variant} is-general`}>
        <div className="gvc-media gvc-jar" aria-hidden="true">
          <GivingJar amount={0} isStatic shape="square" backdrop lazy label="" />
        </div>
        <div className="gvc-body">
          <span className="gvc-eyebrow">Donate</span>
          <strong className="gvc-title">Help fill the jar</strong>
          <span className="gvc-text">Donate to the church&apos;s drives by GCash, Maya or bank transfer, from wherever you are.</span>
          <span className="gvc-cta">Donate</span>
        </div>
      </Tag>
    );
  }

  const { raised, goal, percent, gifts } = campaignProgress(campaign);
  const ends = campaignEnds(campaign);
  const image = campaign.image_url;
  return (
    <Tag href={preview ? undefined : campaignPath(campaign.slug)} className={`gvc gvc-${variant} ${image ? '' : 'no-media'}`}>
      {image && (
        <div className="gvc-media" aria-hidden="true">
          <img src={image} alt="" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="gvc-body">
        <span className="gvc-eyebrow">Donate{ends ? <span className="gvc-ends"> · {ends}</span> : null}</span>
        <strong className="gvc-title">{campaign.title}</strong>
        {campaign.summary && <span className="gvc-text">{campaign.summary}</span>}
        <div className="gvc-fill">
          <div className="gvc-stage">
            <GivingJar {...jarProps(campaign)} shape="square" backdrop animateOnLoad lazy label="" />
          </div>
          <div className="gvc-fill-info">
            {percent != null ? (
              <span className="gvc-progress">
                <span className="gvc-bar" aria-hidden="true"><span style={{ width: `${Math.max(percent, raised > 0 ? 3 : 0)}%` }}></span></span>
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
      </div>
    </Tag>
  );
}
