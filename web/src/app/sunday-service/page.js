import { defaultStream } from '@/lib/sundayService';
import ServiceClient from '@/components/services/ServiceClient';
import { ServiceShell, serviceMetadata, sundayItem } from '@/components/services/servicePage';
import { streamList } from './shared';

// /sunday-service - the Sunday Service live now (else the latest), with every
// service beside it. Each one has its own address, /sunday-service/<slug>
// ([slug]/page.js). /live comes here.

export const revalidate = 60;

export async function generateMetadata() {
  return serviceMetadata('sunday', null);
}

export default async function SundayServicePage() {
  const list = await streamList();
  const current = defaultStream(list);
  return (
    <ServiceShell path="/sunday-service">
      <ServiceClient kind="sunday" items={list.map(sundayItem)} currentSlug={current?.slug || null} />
    </ServiceShell>
  );
}
