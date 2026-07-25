/**
 * Best-effort in-memory sliding-window rate limiter.
 *
 * LIMITATION: state lives in a single process. On serverless / multi-instance
 * deployments each instance keeps its own counters, so this is a coarse
 * safety-net, not a strict global limit. A shared store (e.g. Redis/Upstash)
 * would be required for strict limits — intentionally NOT added here to avoid a
 * new datastore in this round. See README "Known Limitations".
 */

interface Bucket {
  hits: number[]; // timestamps (ms)
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key) ?? { hits: [] };
  // Drop timestamps outside the window.
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    store.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - oldest) };
  }

  bucket.hits.push(now);
  store.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
}

/** Test helper: clear all counters. */
export function __resetRateLimit(): void {
  store.clear();
}
