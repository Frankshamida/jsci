import { redirect } from 'next/navigation';

// The way it is often typed - one "m" - goes to /accommodation, the event
// picked in the link kept.
export default async function AccomodationTypo({ searchParams }) {
  const params = await searchParams;
  const event = typeof params?.event === 'string' ? params.event : '';
  redirect(event ? `/accommodation?event=${encodeURIComponent(event)}` : '/accommodation');
}
