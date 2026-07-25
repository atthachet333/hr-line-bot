import { describe, it, expect } from 'vitest';
import { readJsonBody } from '@/lib/http/guards';
import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '@/lib/errors';

function makeReq(body: string, headers: Record<string, string>): Request {
  return new Request('https://example.com/api/x', { method: 'POST', body, headers });
}

describe('readJsonBody guard', () => {
  it('parses valid JSON', async () => {
    const req = makeReq(JSON.stringify({ a: 1 }), { 'content-type': 'application/json' });
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it('rejects non-JSON content type (415)', async () => {
    const req = makeReq('a=1', { 'content-type': 'text/plain' });
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it('rejects oversized body (413)', async () => {
    const big = JSON.stringify({ x: 'y'.repeat(40 * 1024) });
    const req = makeReq(big, { 'content-type': 'application/json' });
    await expect(readJsonBody(req, { maxBytes: 1024 })).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('rejects empty body', async () => {
    const req = makeReq('', { 'content-type': 'application/json' });
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed JSON', async () => {
    const req = makeReq('{ not json', { 'content-type': 'application/json' });
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(ValidationError);
  });
});
