import { NextResponse } from 'next/server';
import { limit, clientIp, tooManyRequests } from '@/lib/rateLimiter';

/**
 * Per-IP rate limits in front of every API route.
 *
 * This is the app's own layer. Vercel already absorbs volumetric (network-level)
 * DDoS in front of it, and CDN-cached public routes never reach here at all -
 * this catches the traffic that does: scripted login attempts, a bot looping on
 * an endpoint, a runaway client, anything that would burn the Supabase / Groq /
 * Cloudinary quotas.
 *
 * LIMITS ARE PER IP AND DELIBERATELY GENEROUS. A church Wi-Fi, or a mobile
 * carrier's CGNAT, can put hundreds of real members behind one address. The
 * tight limits (5-10 tries per account) live in the auth routes themselves,
 * keyed on the email, where a shared IP does not matter.
 *
 * Raise a number here first if legitimate users ever see "Too many requests".
 * Set RATE_LIMIT_DISABLED=1 in Vercel to switch all of it off without a deploy.
 */

const MINUTE = 60 * 1000;

// Checked in order; first match wins.
const RULES = [
  // Card readers at a desk tap fast and several desks can share one venue IP.
  { name: 'rfid', match: (p) => p.startsWith('/api/rfid/'), max: 900, windowMs: MINUTE },

  // Password checks, OTPs, sign-ups - the brute-force targets.
  {
    name: 'auth',
    match: (p, m) => m !== 'GET' && (
      p.startsWith('/api/auth/')
      || p === '/api/event-committee/login'
      || p === '/api/event-committee/signup'
      || p === '/api/profile/verify-password'
      || p === '/api/profile/admin-password'
      || p === '/api/profile/update-password'
      || p === '/api/profile/set-password'
      || p === '/api/events/public/unlock'
    ),
    max: 60,
    windowMs: MINUTE,
    shared: true,
  },

  // Each call spends Groq tokens.
  {
    name: 'ai',
    match: (p) => p.startsWith('/api/ai/') || p === '/api/moderate' || p === '/api/lyrics',
    max: 30,
    windowMs: MINUTE,
    shared: true,
  },

  // Each call spends Cloudinary / Drive bandwidth and function time.
  { name: 'upload', match: (p, m) => m !== 'GET' && p.includes('upload'), max: 30, windowMs: MINUTE },

  { name: 'write', match: (p, m) => m !== 'GET' && m !== 'HEAD', max: 300, windowMs: MINUTE },
  { name: 'read', match: () => true, max: 1200, windowMs: MINUTE },
];

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  if (method === 'OPTIONS') return NextResponse.next();

  const rule = RULES.find((r) => r.match(pathname, method));
  const ip = clientIp(request);
  const result = await limit(`${rule.name}:${ip}`, rule.max, rule.windowMs, { shared: rule.shared });

  if (!result.allowed) return tooManyRequests(result.retryAfterSec);
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
