import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyLineSignature } from '@/lib/line/signature';

const secret = 'test-channel-secret';
const body = JSON.stringify({ events: [{ type: 'postback' }] });

function sign(rawBody: string, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

describe('verifyLineSignature', () => {
  it('accepts a correct signature', () => {
    expect(verifyLineSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('rejects a wrong signature (test case: invalid webhook signature)', () => {
    expect(verifyLineSignature(body, sign(body, 'other-secret'), secret)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const good = sign(body, secret);
    expect(verifyLineSignature(body + 'x', good, secret)).toBe(false);
  });

  it('rejects when signature header is missing', () => {
    expect(verifyLineSignature(body, null, secret)).toBe(false);
  });

  it('rejects when channel secret is empty', () => {
    expect(verifyLineSignature(body, sign(body, secret), '')).toBe(false);
  });
});
