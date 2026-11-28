'use client';

// Dashboard > Giving (/giving-management; Admin and Super Admin). The sidebar
// lists its two pages, Gifts and Donation drives, and says which is open
// (`tab`); there is no tab strip here.
//
//   Gifts      every gift sent: confirm it once it is in the church's
//              account (the giver is emailed), mark it failed or refunded,
//              and record gifts given in person
//   Donation drives  what the church is asked to donate to: each on
//              /donation/<slug> with its photos and its jar, and, featured,
//              beside the News, in the Community Hub and on the home page
//
// The two lead to each other: a drive's "Gifts" opens Gifts showing only that
// drive's gifts. An old link with ?tab=appeals opens Donation drives.

import { useEffect, useState } from 'react';
import GiftsManager from './GiftsManager';
import CampaignsManager from './CampaignsManager';
import '@/components/social/social.css';
import './givingAdmin.css';

export const GIVING_TABS = ['gifts', 'drives'];

export default function GivingAdmin({ actorId, tab = 'gifts', onTab, onPending }) {
  // What Gifts shows: 'all', 'Tithes', 'Offering', 'drives' or one drive's id.
  const [fund, setFund] = useState('all');

  useEffect(() => {
    let t = null;
    try { t = new URLSearchParams(window.location.search).get('tab'); } catch { /* none */ }
    if (t === 'appeals' || t === 'drives') onTab?.('drives');
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showGifts = (which) => { setFund(which || 'all'); onTab?.('gifts'); };

  return (
    <div className="sm-theme sm">
      {tab === 'drives'
        ? <CampaignsManager actorId={actorId} onSeeGifts={showGifts} />
        : <GiftsManager actorId={actorId} onPending={onPending} fund={fund} onFund={setFund} onOpenDrives={() => onTab?.('drives')} />}
    </div>
  );
}
