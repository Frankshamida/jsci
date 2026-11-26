import { notFound, permanentRedirect } from 'next/navigation';
import { midweekPath } from '@/lib/serviceVideos';
import { resolveSlug } from '@/lib/serviceVideosServer';
import ServiceClient from '@/components/services/ServiceClient';
import { ServiceShell, midweekItem, serviceMetadata } from '@/components/services/servicePage';
import { videoList } from '../shared';

// /midweek/<slug> - one service: /midweek/the-power-of-god.
//   a slug the service had before it was renamed   -> its current address
//                                                     (permanent redirect)
//   no such service (or hidden)                     -> "Service not found"

export const revalidate = 60;

// None built ahead: each service's page is made on its first visit, then kept
// (and rebuilt the moment a video changes in the dashboard).
export async function generateStaticParams() {
  return [];
}

const slugOf = (params) => {
  try { return decodeURIComponent(String(params?.slug || '')); } catch { return String(params?.slug || ''); }
};

export async function generateMetadata({ params }) {
  const { video } = resolveSlug(await videoList(), slugOf(params));
  if (!video) return { title: 'Service not found', robots: { index: false } };
  return serviceMetadata('midweek', midweekItem(video));
}

export default async function MidweekServicePage({ params }) {
  const list = await videoList();
  const { video, moved } = resolveSlug(list, slugOf(params));
  if (moved) permanentRedirect(midweekPath(moved.slug));
  if (!video) notFound();
  return (
    <ServiceShell path={midweekPath(video.slug)}>
      <ServiceClient kind="midweek" items={list.map(midweekItem)} currentSlug={video.slug} />
    </ServiceShell>
  );
}
