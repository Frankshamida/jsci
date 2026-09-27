import EventPublicPage from '@/components/eventPublic/EventPublicPage';

// /events/cebu-miracle-working-god - the programme is the default view.
export default function Page({ params }) {
  return <EventPublicPage slug={params.slug} view="programme" />;
}
