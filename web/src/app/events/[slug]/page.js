import { redirect } from 'next/navigation';
import EventPublicPage from '@/components/eventPublic/EventPublicPage';
import { QR_CHOOSER_SLUGS } from '@/lib/eventPublic';

// /events/cebu-miracle-working-god - the programme is the default view.
//
// The bare address of an event whose IDs were printed with it in their QR
// (QR_CHOOSER_SLUGS - the Cebu delegates') opens Choose your conference
// instead. The page itself, and the chooser's button, use /programme.
export default function Page({ params }) {
  if (QR_CHOOSER_SLUGS.has(String(params.slug || '').toLowerCase())) redirect('/conference');
  return <EventPublicPage slug={params.slug} view="programme" />;
}
