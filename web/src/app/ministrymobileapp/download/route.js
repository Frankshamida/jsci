import { NextResponse } from 'next/server';
import { getLatestMinistryApp } from '@/lib/ministryAppRelease';

// /ministrymobileapp/download - always the newest APK
// ("jsci-ministry-app-1.2.0.apk"). Good for QR codes and links in chats:
// the link stays the same, the file is always the latest version.
export const revalidate = 300;

export async function GET(request) {
  const latest = await getLatestMinistryApp();
  if (!latest) return NextResponse.redirect(new URL('/ministrymobileapp', request.url), 302);
  return NextResponse.redirect(latest.apk.url, 302);
}
