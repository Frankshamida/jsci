import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { RELEASE_REPO, RELEASES_TAG, getLatestMinistryApp } from '@/lib/ministryAppRelease';

// GET - The newest JSCI Ministry version: { version, apkUrl, fileName, publishedAt } or null.
export async function GET() {
  const latest = await getLatestMinistryApp();
  return NextResponse.json({
    success: true,
    data: latest ? { version: latest.version, apkUrl: latest.apk.url, fileName: latest.apk.name, publishedAt: latest.publishedAt } : null,
  });
}

// POST - Show a just-published release now instead of within 5 minutes.
// Called by ministry-app/scripts/release.mjs with the GitHub token it
// published with; only someone who can push to the repository may do it.
export async function POST(request) {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ success: false, message: 'Sign in with a GitHub token.' }, { status: 401 });

  const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'sanctuaryhub-ministry-app' },
    cache: 'no-store',
  });
  const repo = res.ok ? await res.json() : null;
  if (!repo?.permissions?.push) {
    return NextResponse.json({ success: false, message: 'Only people who can publish the app may refresh the page.' }, { status: 403 });
  }

  revalidateTag(RELEASES_TAG);
  revalidatePath('/ministrymobileapp');
  revalidatePath('/ministrymobileapp/download');
  const latest = await getLatestMinistryApp();
  return NextResponse.json({ success: true, message: 'Download page refreshed.', data: { latest: latest?.version || null } });
}
