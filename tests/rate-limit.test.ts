import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, __resetRateLimit } from '@/lib/rate-limit';

describe('rate limiter', () => {
  beforeEach(() => __resetRateLimit());

  it('allows up to the limit then blocks', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit('k', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('separates counters by key', () => {
    expect(rateLimit('a', 1, 60_000).allowed).toBe(true);
    expect(rateLimit('a', 1, 60_000).allowed).toBe(false);
    expect(rateLimit('b', 1, 60_000).allowed).toBe(true);
  });
});
