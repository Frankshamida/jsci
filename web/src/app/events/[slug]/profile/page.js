import EventPublicPage from '@/components/eventPublic/EventPublicPage';

export default function Page({ params }) {
  return <EventPublicPage slug={params.slug} view="profile" />;
}
