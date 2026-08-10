/**
 * Tiny in-process TTL cache + rate limiter for API routes.
 *
 * Purpose: keep the app inside the FREE tiers of Supabase / Cloudinary / Groq.
 * Read-heavy endpoints that many clients poll (usage stats, alert feeds) should
 * serve a cached value instead of hitting the upstream provider once per client.
 *
 * Scope/caveats: state lives in the Node process memory, so it is per-instance and
 * is lost on redeploy or cold start. That is fine here — the goal is collapsing
 * bursts of identical reads, not durable caching. On a multi-instance host each
 * instance keeps its own copy, so budget limits accordingly.
 */

const cache = new Map(); // key -> { value, expiresAt }
const inFlight = new Map(); // key -> Promise (dedupes concurrent misses)
const rateBuckets = new Map(); // key -> { count, windowStart }

// Bound the maps so a pathological key space can't leak memory.
const MAX_ENTRIES = 500;

function evictIfNeeded(map) {
  if (map.size <= MAX_ENTRIES) return;
  // Drop the oldest inserted key (Map preserves insertion order).
  const oldestKey = map.keys().next().value;
  map.delete(oldestKey);
}

/** Read a still-valid cached value, or undefined on miss/expiry. */
export function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

/** Store a value for `ttlMs`. */
export function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  evictIfNeeded(cache);
  return value;
}

/** Drop one key, or everything when called with no argument. */
export function cacheInvalidate(key) {
  if (key === undefined) cache.clear();
  else cache.delete(key);
}

/**
 * Serve `key` from cache, otherwise run `producer()` and cache its result.
 *
 * Concurrent misses for the same key share a single upstream call, so N clients
 * arriving together cost one request instead of N.
 *
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<any>} producer
 */
export async function cached(key, ttlMs, producer) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await producer();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  evictIfNeeded(inFlight);
  return promise;
}

/**
 * Fixed-window rate limit check. Call before doing expensive/metered work.
 *
 * This is a backstop against runaway loops and abuse burning a monthly quota in
 * minutes — not a security control (state is per-instance and in-memory).
 *
 * @param {string} key            identity to limit on (e.g. `groq:<userId>`)
 * @param {number} limit          max allowed calls per window
 * @param {number} windowMs       window length
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    evictIfNeeded(rateBuckets);
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: windowMs - (now - bucket.windowStart),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterMs: 0 };
}

export default { cached, cacheGet, cacheSet, cacheInvalidate, rateLimit };
