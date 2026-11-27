import { NextResponse } from 'next/server';
import { campaignNow, featuredCampaigns, givingMethods, openCampaigns, safely } from '@/lib/givingServer';
import { isUuid } from '@/lib/watchAccess';

export const dynamic = 'force-dynamic';
// Every read fresh. On its own, force-dynamic does not stop Next 14 from
// keeping the database reads of a GET-only route in its data cache for good.
export const revalidate = 0;

// GET /api/giving             -> { campaigns, methods }: the open donation
//                                drives, and the accounts to send a gift to
// GET /api/giving?featured=1  -> { campaigns }: the ones shown beside the News,
//                                in the Community Hub and on the home page
// GET /api/giving?drive=<id>  -> { campaign: { raised, gifts, goal_amount } }:
//                                one drive's jar as it is now, for its open
//                                page (confirmed donations only; a refund
//                                takes its amount away)
// Public. Before giving.sql has been run there are simply no campaigns.
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const drive = params.get('drive');
  if (drive != null) {
    // Ten seconds at the edge: everyone with the page open on one network
    // shares one look at the database.
    const fresh = { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=20' };
    const c = isUuid(drive) ? await safely(() => campaignNow(drive), null) : null;
    if (!c || !c.is_published) return NextResponse.json({ success: false, message: 'That donation drive was not found.' }, { status: 404, headers: fresh });
    return NextResponse.json({ success: true, campaign: { raised: c.raised, gifts: c.gifts, goal_amount: c.goal_amount } }, { headers: fresh });
  }
  const featured = params.get('featured') === '1';
  const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60' };
  if (featured) {
    return NextResponse.json({ success: true, campaigns: await safely(featuredCampaigns, []) }, { headers });
  }
  const [campaigns, methods] = await Promise.all([safely(openCampaigns, []), safely(givingMethods, [])]);
  return NextResponse.json({ success: true, campaigns, methods }, { headers });
}
