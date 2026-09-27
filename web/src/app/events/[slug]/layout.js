import { eventForPublicSlug } from '@/lib/eventAccess';
import { SITE_NAME } from '@/lib/socialCard';
import { publicEventTitle } from '@/lib/eventPublic';
import '@/components/eventPublic/eventPublic.css';

// The public event page: /events/cebu-miracle-working-god[/programme|/photos].
// The tab title and share card name the event; the page itself is client side.
export async function generateMetadata({ params }) {
  try {
    const event = await eventForPublicSlug(params.slug);
    if (!event) return { title: `Event | ${SITE_NAME}` };
    const title = publicEventTitle(event);
    return {
      title: `${title} | ${SITE_NAME}`,
      description: `Programme and photos for ${title}.`,
      openGraph: {
        title,
        description: `Programme and photos for ${title}.`,
        images: event.image_url ? [{ url: event.image_url }] : undefined,
      },
    };
  } catch {
    return { title: SITE_NAME };
  }
}

export default function EventPublicLayout({ children }) {
  return children;
}
