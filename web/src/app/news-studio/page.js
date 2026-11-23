import { redirect } from 'next/navigation';

// /news-studio on its own: the list of articles lives in the dashboard.
export default function NewsStudioIndex() {
  redirect('/news-management');
}
