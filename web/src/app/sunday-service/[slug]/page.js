import { notFound, permanentRedirect } from 'next/navigation';
import { resolveSlug } from '@/lib/serviceVideosServer';
import { sundayPath } from '@/lib/sundayService';
import ServiceClient from '@/components/services/ServiceClient';
import { ServiceShell, serviceMetadata, sundayItem } from '@/components/services/servicePage';
import { streamList } from '../shared';

// /sunday-service/<slug> - one service: /sunday-service/2026-11-29, or
// /sunday-service/faith-over-fear for one with a title of its own.
//   a slug the service had before (renamed, or moved to another date)
//                                    -> its current address (permanent redirect)
//   no such service (or hidden)      -> "Service not found"

export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

const slugOf = (params) => {
  try { return decodeURIComponent(String(params?.slug || '')); } catch { return String(params?.slug || ''); }
};

export async function generateMetadata({ params }) {
  const { video } = resolveSlug(await streamList(), slugOf(params));
  if (!video) return { title: 'Service not found', robots: { index: false } };
  return serviceMetadata('sunday', sundayItem(video));
}

export default async function SundayServiceOnePage({ params }) {
  const list = await streamList();
  const { video, moved } = resolveSlug(list, slugOf(params));
  if (moved) permanentRedirect(sundayPath(moved.slug));
  if (!video) notFound();
  return (
    <ServiceShell path={sundayPath(video.slug)}>
      <ServiceClient kind="sunday" items={list.map(sundayItem)} currentSlug={video.slug} />
    </ServiceShell>
  );
}
