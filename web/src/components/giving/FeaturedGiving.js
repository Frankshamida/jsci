'use client';

// The giving card, drawn in the browser - for the Community Hub: the newest
// featured appeal, with its jar. With none featured, nothing is shown.
// Nothing is drawn until the answer is in, so nothing jumps.

import GivingCard from './GivingCard';
import { useFeaturedCampaigns } from '@/lib/givingClient';

export default function FeaturedGiving({ variant = 'hub', className = '' }) {
  const campaigns = useFeaturedCampaigns();
  if (!campaigns?.length) return null;
  return (
    <div className={className}>
      <GivingCard campaign={campaigns[0]} variant={variant} />
    </div>
  );
}
