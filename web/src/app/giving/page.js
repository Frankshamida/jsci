import { permanentRedirect, redirect } from 'next/navigation';
import { campaignPath, jarPath, receiptPath } from '@/lib/giving';
import { campaignNow, giftByToken, safely } from '@/lib/givingServer';

// /giving moved: donation drives are on /donation, tithes and offerings on
// the Sunday Service page. An early "your gift is confirmed" email linked to
// /giving?gift=<token>: that goes to the gift's drive (its hearts drop into
// the jar there), or, for a tithe or an offering, to its receipt.

export const dynamic = 'force-dynamic';

export default async function OldGivingPage({ searchParams }) {
  const token = String(searchParams?.gift || '');
  if (token) {
    const gift = await safely(() => giftByToken(token), null);
    if (gift?.campaign_id) {
      const drive = await safely(() => campaignNow(gift.campaign_id), null);
      if (drive?.is_published) redirect(jarPath(drive.slug, gift.token));
    }
    if (gift) redirect(receiptPath(gift.token));
  }
  permanentRedirect(campaignPath(null));
}
