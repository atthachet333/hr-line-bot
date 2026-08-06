import { describe, it, expect } from 'vitest';
import { maskId } from '@/lib/utils/mask';
import { redact } from '@/lib/logger';

describe('maskId', () => {
  it('masks a LINE id keeping only a short prefix + suffix', () => {
    const out = maskId('U1234567890abcdef');
    expect(out).toBe('U123…cdef');
    expect(out).not.toContain('567890ab');
  });

  it('handles short / empty ids', () => {
    expect(maskId('')).toBe('');
    expect(maskId(undefined)).toBe('');
    expect(maskId('U12345')).toBe('U1…');
  });
});

describe('webhook token fields are redacted by the logger', () => {
  it('never leaks reply/quote/markAsRead tokens or access tokens', () => {
    const out = redact({
      replyToken: 'rt-secret',
      quoteToken: 'qt-secret',
      markAsReadToken: 'mr-secret',
      accessToken: 'at-secret',
      channelSecret: 'cs-secret',
      eventType: 'message',
    }) as Record<string, unknown>;
    expect(out.replyToken).toBe('[REDACTED]');
    expect(out.quoteToken).toBe('[REDACTED]');
    expect(out.markAsReadToken).toBe('[REDACTED]');
    expect(out.accessToken).toBe('[REDACTED]');
    expect(out.channelSecret).toBe('[REDACTED]');
    // Non-sensitive summary fields survive.
    expect(out.eventType).toBe('message');
  });
});
