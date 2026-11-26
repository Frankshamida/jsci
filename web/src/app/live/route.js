import { NextResponse } from 'next/server';

// /live was the live page's address. It is /sunday-service now; links to the
// old one - shared, bookmarked, printed - arrive there (permanent, 301).
export function GET(request) {
  return NextResponse.redirect(new URL('/sunday-service', request.url), 301);
}
