import { permanentRedirect } from 'next/navigation';
import { campaignPath } from '@/lib/giving';

// /giving/<slug> moved to /donation/<slug>. (/giving/my and /giving/receipt
// are pages of their own and are not caught here.)

export const dynamic = 'force-dynamic';

export default function OldDrivePage({ params }) {
  permanentRedirect(campaignPath(params.slug));
}
