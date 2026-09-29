/**
 * Rate limiting that works in both Edge middleware and Node API routes.
 *
 * Two stores:
 *
 *  - memory  — a Map in this instance. Free and instant, but every Vercel
 *              instance keeps its own count, so a flood spread across many
 *              instances is only partly caught. Good enough for the general
 *              "one IP is hammering us" case.
 *  - shared  — Upstash Redis over REST, when UPSTASH_REDIS_REST_URL and
 *              UPSTASH_REDIS_REST_TOKEN are set. One count for the whole
 *              deployment. Used only for the low-volume, high-value buckets
 *              (logins, OTPs, AI) so it never eats the Upstash free quota.
 *
 * If Upstash is missing, slow or down, `shared` silently falls back to memory:
 * the limiter must never be the thing that takes the site offline.
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UPSTASH_TIMEOUT_MS = 800;

export const sharedStoreConfigured = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

const buckets = new Map(); // key -> { count, resetAt }
const MAX_BUCKETS = 10000;

function sweep(now) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
  // Still full (a real flood of distinct keys): drop the oldest half.
  if (buckets.size > MAX_BUCKETS) {
    let drop = buckets.size / 2;
    for (const key of buckets.keys()) {
      if (drop-- <= 0) break;
      buckets.delete(key);
    }
  }
}

function memoryHit(key, windowMs, now) {
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
    sweep(now);
  }
  b.count += 1;
  return { count: b.count, resetAt: b.resetAt };
}

async function sharedHit(key, windowMs, now) {
  // Fixed window: the window index is part of the key, so no read-modify-write.
  const windowIndex = Math.floor(now / windowMs);
  const redisKey = `rl:${key}:${windowIndex}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', redisKey], ['PEXPIRE', redisKey, String(windowMs)]]),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const [incr] = await res.json();
    if (typeof incr?.result !== 'number') return null;
    return { count: incr.result, resetAt: (windowIndex + 1) * windowMs };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Count one hit against `key` and say whether it is within `max` per `windowMs`.
 *
 * @param {string} key
 * @param {number} max
 * @param {number} windowMs
 * @param {{ shared?: boolean }} [opts]  shared: count across all instances (Upstash)
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterSec: number }>}
 */
export async function limit(key, max, windowMs, opts = {}) {
  if (process.env.RATE_LIMIT_DISABLED === '1') {
    return { allowed: true, remaining: max, retryAfterSec: 0 };
  }
  const now = Date.now();
  const hit = (opts.shared && sharedStoreConfigured && (await sharedHit(key, windowMs, now)))
    || memoryHit(key, windowMs, now);
  const allowed = hit.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - hit.count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((hit.resetAt - now) / 1000)),
  };
}

/** The caller's IP as Vercel reports it. */
export function clientIp(request) {
  if (request.ip) return request.ip;
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/** The standard 429 body, in the { success, message } shape every page already reads. */
export function tooManyRequests(retryAfterSec, message) {
  return new Response(
    JSON.stringify({
      success: false,
      message: message || 'Too many requests. Please wait a moment and try again.',
      retryAfter: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
        'Cache-Control': 'no-store',
      },
    },
  );
}
