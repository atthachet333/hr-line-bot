import { describe, it, expect } from 'vitest';
import { redact } from '@/lib/logger';

describe('logger redaction', () => {
  it('redacts sensitive keys at any depth', () => {
    const input = {
      accessToken: 'abc123',
      nested: { channelSecret: 'shhh', idToken: 'jwt', ok: 'visible' },
      authorization: 'Bearer xyz',
      list: [{ apiKey: 'k' }],
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.accessToken).toBe('[REDACTED]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.channelSecret).toBe('[REDACTED]');
    expect(nested.idToken).toBe('[REDACTED]');
    expect(nested.ok).toBe('visible');
    expect(out.authorization).toBe('[REDACTED]');
    expect((out.list as Array<Record<string, unknown>>)[0].apiKey).toBe('[REDACTED]');
  });

  it('redacts bearer tokens embedded in strings', () => {
    const out = redact({ note: 'call with Bearer abc.def-ghi token' }) as Record<string, string>;
    expect(out.note).toContain('Bearer [REDACTED]');
    expect(out.note).not.toContain('abc.def-ghi');
  });

  it('leaves plain values untouched', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
