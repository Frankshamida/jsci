import { defaultVideo } from '@/lib/serviceVideos';
import ServiceClient from '@/components/services/ServiceClient';
import { ServiceShell, midweekItem, serviceMetadata } from '@/components/services/servicePage';
import { videoList } from './shared';

// /midweek - the latest Midweek Service, with every service beside it.
// Each one has its own address, /midweek/<slug> ([slug]/page.js).

export const revalidate = 60;

export async function generateMetadata() {
  return serviceMetadata('midweek', null);
}

export default async function MidweekPage() {
  const list = await videoList();
  const current = defaultVideo(list);
  return (
    <ServiceShell path="/midweek">
      <ServiceClient kind="midweek" items={list.map(midweekItem)} currentSlug={current?.slug || null} />
    </ServiceShell>
  );
}
